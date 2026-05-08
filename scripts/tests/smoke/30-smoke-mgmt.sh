#!/usr/bin/env bash
# Smoke test for the HyperCache management HTTP endpoints. Hits a
# live cache server's mgmt port (default 8081 on the host, mapped
# to the cluster's :8081 in docker-compose.cluster.yml). The
# monitor's Topology, Metrics, and Auth-posture pages all consume
# this surface; drift here surfaces as a 502 or zod parse failure
# in those pages.
#
# What's covered:
#   1. GET /health                  — operator-facing liveness
#   2. GET /stats                   — per-name stats (read-only)
#   3. GET /config                  — cache configuration
#   4. GET /dist/metrics            — distributed counters
#   5. GET /dist/owners?key=foo     — ring lookup for a key
#   6. GET /cluster/members         — SWIM membership
#   7. GET /cluster/ring            — vnode → owner mapping
#   8. GET /cluster/heartbeat       — heartbeat probe metrics
#
# Read-only by design — this script never POSTs to /evict /clear
# /trigger-expiration. Those mutating endpoints are admin-gated
# (Phase C) and live-test scope is tracked separately.
#
# Usage:
#   ./scripts/smoke-mgmt.sh
#   HYPERCACHE_MGMT_URL=http://cache-1:8081 HYPERCACHE_TOKEN=admin-tok ./scripts/smoke-mgmt.sh
#
# NOTE: env var name is `HYPERCACHE_MGMT_URL` (not API_URL — this
# script targets the mgmt listener, which the cache binds on a
# different port from the client API).
#
# Exit codes:
#   0 — all assertions passed
#   1 — at least one assertion failed (operator gets the full report)
#   2 — pre-flight failed (curl/jq missing, server unreachable)

set -euo pipefail

readonly MGMT_URL="${HYPERCACHE_MGMT_URL:-http://localhost:9081}"
readonly TOKEN="${HYPERCACHE_TOKEN:-dev-token}"
readonly REQ_TIMEOUT="${HYPERCACHE_REQ_TIMEOUT:-15}"

fail_count=0

# ---- Output helpers --------------------------------------------------

log_ok() {
	if [[ -t 1 ]]; then
		printf '\033[32m OK \033[0m %s\n' "$1"
	else
		printf ' OK  %s\n' "$1"
	fi
}

log_fail() {
	if [[ -t 1 ]]; then
		printf '\033[31mFAIL\033[0m %s\n' "$1"
	else
		printf 'FAIL %s\n' "$1"
	fi
	fail_count=$((fail_count + 1))
}

log_info() {
	if [[ -t 1 ]]; then
		printf '\033[36mINFO\033[0m %s\n' "$1"
	else
		printf 'INFO %s\n' "$1"
	fi
}

# ---- Pre-flight ------------------------------------------------------

require_cmd() {
	if ! command -v "$1" >/dev/null 2>&1; then
		printf 'pre-flight: missing required command: %s\n' "$1" >&2
		exit 2
	fi
}

require_cmd curl
require_cmd jq

# /health is auth-required when AUTH_TOKEN is set; we need the
# token already. A 200 OR a 401 here both signal "server is up".
# Connection-refused / DNS failure means the server isn't running.
PROBE_STATUS=$(curl -sS -o /dev/null --max-time "$REQ_TIMEOUT" -w '%{http_code}' \
	-H "Authorization: Bearer $TOKEN" \
	"$MGMT_URL/health" || echo "000")
if [[ "$PROBE_STATUS" == "000" ]]; then
	printf 'pre-flight: cache mgmt server unreachable at %s\n' "$MGMT_URL" >&2
	printf "hint: start a cluster with 'make start-dev-scaled' (sibling cache repo).\n" >&2
	printf "hint: cluster compose maps host :9081 to container :8081 (mgmt port).\n" >&2
	exit 2
fi

log_info "MGMT:   $MGMT_URL"
echo

# ---- Test helpers ----------------------------------------------------

LAST_STATUS=""
LAST_BODY_FILE="/tmp/hyp-mgmt-body.json"

# get PATH → sets LAST_STATUS; body lands at LAST_BODY_FILE.
# Curl-level failures collapse to "000" with a loud log line so
# the downstream assert_status reports clean rather than matching
# against an empty body.
get() {
	local path="$1"
	local curl_exit=0
	LAST_STATUS=$(curl -sS -o "$LAST_BODY_FILE" --max-time "$REQ_TIMEOUT" -w '%{http_code}' \
		-H "Authorization: Bearer $TOKEN" \
		"$MGMT_URL$path") || curl_exit=$?
	if [[ $curl_exit -ne 0 ]]; then
		log_fail "curl failed (exit $curl_exit) on GET $path — likely timeout (>${REQ_TIMEOUT}s) or connection refused"
		: > "$LAST_BODY_FILE"
		LAST_STATUS="000"
	fi
}

assert_status() {
	local want="$1"
	local got="$2"
	local name="${3:-status check}"
	if [[ "$got" == "$want" ]]; then
		log_ok "$name (HTTP $got)"
	else
		log_fail "$name: got HTTP $got, want $want"
	fi
}

assert_jq() {
	local expr="$1"
	local want="$2"
	local name="${3:-jq assert}"
	local got
	got=$(jq -r "$expr" "$LAST_BODY_FILE" 2>/dev/null || echo '<jq error>')
	if [[ "$got" == "$want" ]]; then
		log_ok "$name → $got"
	else
		log_fail "$name: got '$got', want '$want'; body: $(cat "$LAST_BODY_FILE")"
	fi
}

# ---- 1. /health ----------------------------------------------------

log_info "1. /health — operator-facing liveness"

get "/health"
assert_status "200" "$LAST_STATUS" "/health returns 200"
if [[ "$(cat "$LAST_BODY_FILE")" == "ok" ]]; then
	log_ok "/health body is 'ok'"
else
	log_fail "/health body mismatch: got '$(cat "$LAST_BODY_FILE")', want 'ok'"
fi
echo

# ---- 2. /stats -----------------------------------------------------

log_info "2. /stats — per-name stats map"

get "/stats"
assert_status "200" "$LAST_STATUS" "/stats returns 200"
# Shape: Record<string, Stat>. May be empty if no StatsCollector
# middleware is wired; the test only requires it parse as an object.
assert_jq 'type' "object" "/stats response is an object"
echo

# ---- 3. /config ----------------------------------------------------

log_info "3. /config — cache configuration"

get "/config"
assert_status "200" "$LAST_STATUS" "/config returns 200"
assert_jq '.capacity >= 0' "true" "/config carries non-negative capacity"
assert_jq '.allocation >= 0' "true" "/config carries non-negative allocation"
assert_jq '.evictionAlgorithm | type' "string" "/config evictionAlgorithm is string"
assert_jq '.evictionInterval | type' "string" "/config evictionInterval is Go-duration string"
assert_jq '.expirationInterval | type' "string" "/config expirationInterval is Go-duration string"
echo

# ---- 4. /dist/metrics ----------------------------------------------

log_info "4. /dist/metrics — distributed counters"

get "/dist/metrics"
assert_status "200" "$LAST_STATUS" "/dist/metrics returns 200"
# Sanity-check a handful of fields the monitor's Metrics dashboard
# consumes. PascalCase per the Go-side struct.
assert_jq 'has("ForwardGet")' "true" "/dist/metrics has ForwardGet"
assert_jq 'has("HeartbeatSuccess")' "true" "/dist/metrics has HeartbeatSuccess"
assert_jq 'has("MembershipVersion")' "true" "/dist/metrics has MembershipVersion"
assert_jq 'has("MembersAlive")' "true" "/dist/metrics has MembersAlive"
assert_jq '.MembersAlive >= 1' "true" "MembersAlive is at least 1 (this node counts)"
echo

# ---- 5. /dist/owners?key=… -----------------------------------------

log_info "5. /dist/owners?key=… — ring lookup for a synthetic key"

get "/dist/owners?key=smoke-mgmt-probe"
assert_status "200" "$LAST_STATUS" "/dist/owners returns 200"
assert_jq '.key' "smoke-mgmt-probe" "/dist/owners echoes the queried key"
assert_jq '.owners | length >= 1' "true" "/dist/owners returns ≥ 1 owner"

# Required-key edge case — without ?key the cache returns 400.
get "/dist/owners"
assert_status "400" "$LAST_STATUS" "/dist/owners without key returns 400"
echo

# ---- 6. /cluster/members -------------------------------------------

log_info "6. /cluster/members — SWIM membership"

get "/cluster/members"
assert_status "200" "$LAST_STATUS" "/cluster/members returns 200"
assert_jq '.replication >= 1' "true" "/cluster/members carries replication factor"
assert_jq '.virtualNodes >= 1' "true" "/cluster/members carries vnode count"
assert_jq '.members | length >= 1' "true" "/cluster/members has ≥ 1 member"
# PascalCase wire shape (Go struct without json: tags).
assert_jq '.members[0] | has("ID")' "true" "first member has ID field"
assert_jq '.members[0] | has("Address")' "true" "first member has Address field"
assert_jq '.members[0] | has("State")' "true" "first member has State field"
echo

# ---- 7. /cluster/ring ----------------------------------------------

log_info "7. /cluster/ring — vnode → owner mapping"

get "/cluster/ring"
assert_status "200" "$LAST_STATUS" "/cluster/ring returns 200"
assert_jq '.count >= 1' "true" "/cluster/ring count ≥ 1"
assert_jq '.vnodes | length >= 1' "true" "/cluster/ring vnodes array non-empty"
# Vnodes are flat "hash:ownerId" strings (see DistRingHashSpots).
assert_jq '.vnodes[0] | type' "string" "first vnode entry is a string"
assert_jq '.vnodes[0] | contains(":")' "true" "first vnode contains ':' separator"
echo

# ---- 8. /cluster/heartbeat -----------------------------------------

log_info "8. /cluster/heartbeat — heartbeat probe metrics"

get "/cluster/heartbeat"
assert_status "200" "$LAST_STATUS" "/cluster/heartbeat returns 200"
# camelCase wire shape (DistHeartbeatMetrics returns map[string]any).
assert_jq 'type' "object" "/cluster/heartbeat is an object"
assert_jq 'has("heartbeatSuccess")' "true" "/cluster/heartbeat has heartbeatSuccess"
echo

# ---- Summary --------------------------------------------------------

if [[ $fail_count -eq 0 ]]; then
	if [[ -t 1 ]]; then
		printf '\033[32mPASS\033[0m all mgmt-endpoint smoke checks succeeded.\n'
	else
		printf 'PASS all mgmt-endpoint smoke checks succeeded.\n'
	fi
	exit 0
else
	if [[ -t 1 ]]; then
		printf '\033[31mFAIL\033[0m %d assertion(s) failed.\n' "$fail_count"
	else
		printf 'FAIL %d assertion(s) failed.\n' "$fail_count"
	fi
	exit 1
fi
