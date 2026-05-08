#!/usr/bin/env bash
# Smoke test for the HyperCache single-key endpoints. Hits a live
# cache server's client API (port 8080 by default), bypassing the
# Next.js proxy. Validates the wire contract between
# `cmd/hypercache-server/main.go` and the monitor's
# `src/lib/api/keys.ts` schemas — drift here surfaces as a
# 502 or zod parse failure on the /keys page.
#
# What's covered:
#   1. PUT /v1/cache/{key}           — store with optional ?ttl
#   2. GET /v1/cache/{key}           — default: raw bytes
#                                      Accept:json: ItemEnvelope
#   3. HEAD /v1/cache/{key}          — metadata in X-Cache-*
#                                      response headers
#   4. GET /v1/owners/{key}          — owners array
#   5. DELETE /v1/cache/{key}        — removes the key
#   6. Edge cases:
#        - 404 on missing key (default + json variants)
#        - 400 on invalid ttl format
#
# Usage:
#   ./scripts/smoke-keys.sh
#   HYPERCACHE_API_URL=http://cache-1:8080 HYPERCACHE_TOKEN=admin-tok ./scripts/smoke-keys.sh
#
# Exit codes:
#   0 — all assertions passed
#   1 — at least one assertion failed (operator gets the full report)
#   2 — pre-flight failed (curl/jq missing, server unreachable)

set -euo pipefail

readonly API_URL="${HYPERCACHE_API_URL:-http://localhost:8081}"
readonly TOKEN="${HYPERCACHE_TOKEN:-dev-token}"
readonly REQ_TIMEOUT="${HYPERCACHE_REQ_TIMEOUT:-15}"
readonly SETTLE_MS="${HYPERCACHE_SETTLE_MS:-500}"
# Total wall-clock budget for the post-delete propagation check.
# Polled at 250ms intervals (see the retry loop in §6) — 5s is
# generous on a 5-node cluster where replicas converge well
# under one heartbeat (1s default). Bump for laggier setups.
readonly POST_DELETE_BUDGET_MS="${HYPERCACHE_POST_DELETE_BUDGET_MS:-5000}"
TIMESTAMP="$(date +%s)"
readonly TIMESTAMP
readonly PREFIX="smoke-keys-${TIMESTAMP}-$$"

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

sleep_settle() {
	sleep "$(awk "BEGIN { print $SETTLE_MS / 1000 }")"
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

if ! curl -sS -o /dev/null --max-time "$REQ_TIMEOUT" "$API_URL/v1/openapi.yaml"; then
	printf 'pre-flight: cache server unreachable at %s\n' "$API_URL" >&2
	printf "hint: start a cluster with 'make start-dev-scaled' (sibling cache repo).\n" >&2
	exit 2
fi

log_info "API:    $API_URL"
log_info "prefix: $PREFIX"
echo

# ---- Cleanup trap ----------------------------------------------------

# shellcheck disable=SC2329  # invoked indirectly via the EXIT trap
cleanup() {
	for suffix in text bin ttl; do
		curl -sS -o /dev/null --max-time "$REQ_TIMEOUT" \
			-H "Authorization: Bearer $TOKEN" \
			-X DELETE \
			"$API_URL/v1/cache/${PREFIX}-${suffix}" || true
	done
}
trap cleanup EXIT

# ---- Test helpers ----------------------------------------------------

LAST_STATUS=""
LAST_BODY_FILE="/tmp/hyp-keys-body.bin"
LAST_HEADER_FILE="/tmp/hyp-keys-headers.txt"

# request VERB PATH [HEADERS_AS_-H_FLAGS_AND_DATA] → sets LAST_STATUS,
# writes body to LAST_BODY_FILE, response headers to LAST_HEADER_FILE.
# Curl-level errors (timeout, connection refused) collapse to status
# "000" with a loud log line + cleared body/header files so subsequent
# assertions don't match against stale data from the previous call.
#
# HEAD specifically: curl needs `-I`/`--head` (NOT `-X HEAD`). With
# `-X HEAD`, curl sends the HEAD verb but uses GET-semantic body
# handling — it waits indefinitely for a body that, per HTTP spec,
# will never come, then exits with code 28 (timeout). `-I` tells
# curl "this is a HEAD request, no body to read."
request() {
	local verb="$1"
	local path="$2"
	shift 2
	local curl_exit=0
	if [[ "$verb" == "HEAD" ]]; then
		LAST_STATUS=$(curl -sS --head -o "$LAST_BODY_FILE" --max-time "$REQ_TIMEOUT" -w '%{http_code}' \
			-D "$LAST_HEADER_FILE" \
			-H "Authorization: Bearer $TOKEN" \
			"$@" \
			"$API_URL$path") || curl_exit=$?
	else
		LAST_STATUS=$(curl -sS -o "$LAST_BODY_FILE" --max-time "$REQ_TIMEOUT" -w '%{http_code}' \
			-D "$LAST_HEADER_FILE" \
			-H "Authorization: Bearer $TOKEN" \
			-X "$verb" \
			"$@" \
			"$API_URL$path") || curl_exit=$?
	fi
	if [[ $curl_exit -ne 0 ]]; then
		log_fail "curl failed (exit $curl_exit) on $verb $path — likely timeout (>${REQ_TIMEOUT}s) or connection refused"
		: >"$LAST_BODY_FILE"
		: >"$LAST_HEADER_FILE"
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

# assert_header HEADER_NAME PRESENT_OR_REGEX [TEST_NAME]
# Verifies the named response header is present and (optionally) matches a regex.
assert_header() {
	local header="$1"
	local pattern="$2"
	local name="${3:-header check}"
	local value
	# HTTP header names are case-insensitive on the wire; lowercase
	# both sides before grepping. -i on grep would also work but
	# normalizing the value lets the assertion message show what
	# we matched.
	value=$(awk -v h="$(echo "$header" | tr '[:upper:]' '[:lower:]')" \
		'BEGIN{IGNORECASE=1} tolower($1) == h":" { sub(/\r$/,""); $1=""; sub(/^ +/,""); print; exit }' \
		"$LAST_HEADER_FILE")
	if [[ -z "$value" ]]; then
		log_fail "$name: header '$header' missing"
		return
	fi
	if [[ "$value" =~ $pattern ]]; then
		log_ok "$name → $header: $value"
	else
		log_fail "$name: header '$header' = '$value' did not match /$pattern/"
	fi
}

# ---- 1. PUT a value (text + binary + TTL'd) -------------------------

log_info "1. PUT three keys (text, raw binary with null+high bytes, TTL'd)"

request PUT "/v1/cache/${PREFIX}-text" \
	-H "Content-Type: text/plain" --data-raw "hello world"
assert_status "200" "$LAST_STATUS" "PUT text key returns 200"
assert_jq '.stored' "true" "PUT text key stored=true"
assert_jq '.bytes' "11" "PUT text key bytes=11"

# Binary fidelity test: 5 bytes including a null + a high byte.
# Must go through a temp file rather than `--data-binary $'\x00…'`
# inline — bash passes shell-arg strings to execve as null-
# terminated C-strings, so a leading null byte truncates curl's
# argument to empty (cache then reports bytes=0). Stdin / @file
# preserves all bytes verbatim.
BINFILE=$(mktemp)
printf '\x00\x01\x02\xfe\xff' >"$BINFILE"
request PUT "/v1/cache/${PREFIX}-bin" \
	-H "Content-Type: application/octet-stream" --data-binary "@$BINFILE"
rm -f "$BINFILE"
assert_status "200" "$LAST_STATUS" "PUT binary key returns 200"
assert_jq '.stored' "true" "PUT binary key stored=true"
assert_jq '.bytes' "5" "PUT binary key bytes=5"

request PUT "/v1/cache/${PREFIX}-ttl?ttl=60s" \
	-H "Content-Type: text/plain" --data-raw "with ttl"
assert_status "200" "$LAST_STATUS" "PUT TTL'd key returns 200"
assert_jq '.stored' "true" "PUT TTL'd key stored=true"
assert_jq '.ttl_ms' "60000" "PUT TTL'd key ttl_ms=60000"
echo

# Replication settle: distributed cluster propagates replicas
# asynchronously (see equivalent comment in smoke-bulk.sh).
log_info "settling for ${SETTLE_MS}ms (replica propagation)"
sleep_settle
echo

# ---- 2. GET (default + Accept: application/json) -------------------

log_info "2. GET — default (raw bytes) + Accept:application/json (envelope)"

request GET "/v1/cache/${PREFIX}-text"
assert_status "200" "$LAST_STATUS" "GET text key default returns 200"
if [[ "$(cat "$LAST_BODY_FILE")" == "hello world" ]]; then
	log_ok "GET text key body matches PUT'd value"
else
	log_fail "GET text key body mismatch: got '$(cat "$LAST_BODY_FILE")'"
fi
assert_header "Content-Type" "application/octet-stream" "GET text key Content-Type"

request GET "/v1/cache/${PREFIX}-text" -H "Accept: application/json"
assert_status "200" "$LAST_STATUS" "GET text key (Accept:json) returns 200"
assert_jq '.key' "${PREFIX}-text" "envelope key matches"
assert_jq '.value_encoding' "base64" "envelope value_encoding=base64"
assert_jq '.version | type' "number" "envelope version is a number"
assert_jq '.version >= 0' "true" "envelope version is non-negative"
assert_jq '.owners | length >= 1' "true" "envelope owners populated"

request GET "/v1/cache/${PREFIX}-ttl" -H "Accept: application/json"
assert_jq '.ttl_ms > 0' "true" "TTL'd envelope carries positive ttl_ms"
echo

# ---- 3. HEAD — metadata in response headers -------------------------

log_info "3. HEAD — metadata in X-Cache-* response headers"

request HEAD "/v1/cache/${PREFIX}-text"
assert_status "200" "$LAST_STATUS" "HEAD text key returns 200"
assert_header "X-Cache-Version" "^[0-9]+$" "HEAD text key X-Cache-Version is integer"
assert_header "X-Cache-Owners" "[a-z0-9-]" "HEAD text key X-Cache-Owners non-empty"
assert_header "X-Cache-Node" "[a-z0-9-]" "HEAD text key X-Cache-Node non-empty"

request HEAD "/v1/cache/${PREFIX}-ttl"
assert_header "X-Cache-Ttl-Ms" "^[0-9]+$" "HEAD TTL'd key X-Cache-Ttl-Ms is integer"
echo

# ---- 4. GET /v1/owners/{key} ---------------------------------------

log_info "4. GET /v1/owners/{key} — owners array"

request GET "/v1/owners/${PREFIX}-text"
assert_status "200" "$LAST_STATUS" "owners endpoint returns 200"
assert_jq '.key' "${PREFIX}-text" "owners response key matches"
assert_jq '.owners | length >= 1' "true" "owners array non-empty"
echo

# ---- 5. Edge cases --------------------------------------------------

log_info "5. Edge cases — 404 on missing key, 400 on bad TTL"

request GET "/v1/cache/${PREFIX}-does-not-exist"
assert_status "404" "$LAST_STATUS" "GET missing key returns 404"

request GET "/v1/cache/${PREFIX}-does-not-exist" -H "Accept: application/json"
assert_status "404" "$LAST_STATUS" "GET missing key (Accept:json) returns 404"
assert_jq '.code' "NOT_FOUND" "404 envelope carries code=NOT_FOUND"

request PUT "/v1/cache/${PREFIX}-bad-ttl?ttl=junk" \
	-H "Content-Type: text/plain" --data-raw "x"
assert_status "400" "$LAST_STATUS" "PUT with bad ttl returns 400"
assert_jq '.code' "BAD_REQUEST" "bad-ttl envelope carries code=BAD_REQUEST"
echo

# ---- 6. DELETE + verification --------------------------------------

log_info "6. DELETE — removes the key"

request DELETE "/v1/cache/${PREFIX}-text"
assert_status "200" "$LAST_STATUS" "DELETE text key returns 200"
assert_jq '.deleted' "true" "DELETE text key deleted=true"

# Retry-until-eventually-404 rather than a single check after a
# fixed sleep. A 5-node cluster with replication=3 propagates
# tombstones via the same gossip-driven path as Sets, but timing
# can vary (heartbeat 1s, indirect-probe k=2). A bare 500ms
# settle was tight enough to flake on a healthy cluster — and a
# blanket increase to "wait long enough" hides any future real
# cache regression. The poll-and-retry shape distinguishes
# timing from a true propagation bug: if it converges within
# the budget, we report OK; if it doesn't, we surface the
# response body so an operator can bisect.
log_info "verifying delete propagation (retry up to ${POST_DELETE_BUDGET_MS}ms)"
deadline=$(($(date +%s%N) / 1000000 + POST_DELETE_BUDGET_MS))
got_status=""
attempts=0
while true; do
	attempts=$((attempts + 1))
	request GET "/v1/cache/${PREFIX}-text" -H "Accept: application/json"
	got_status="$LAST_STATUS"
	if [[ "$got_status" == "404" ]]; then
		break
	fi
	now=$(($(date +%s%N) / 1000000))
	if ((now >= deadline)); then
		break
	fi
	sleep 0.25
done
if [[ "$got_status" == "404" ]]; then
	log_ok "post-delete GET returns 404 (after $attempts attempt(s))"
else
	log_fail "post-delete GET still returns $got_status after ${POST_DELETE_BUDGET_MS}ms / $attempts attempts; body: $(cat "$LAST_BODY_FILE")"
fi
echo

# ---- Summary --------------------------------------------------------

if [[ $fail_count -eq 0 ]]; then
	if [[ -t 1 ]]; then
		printf '\033[32mPASS\033[0m all single-key smoke checks succeeded.\n'
	else
		printf 'PASS all single-key smoke checks succeeded.\n'
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
