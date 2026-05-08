#!/usr/bin/env bash
# Smoke test for the HyperCache batch endpoints. Hits a live
# cache server's client API directly (port 8080 by default),
# bypassing the Next.js proxy. Validates the wire contract
# between `cmd/hypercache-server/main.go` and the monitor's
# `src/lib/api/bulk.ts` schemas — a drift here surfaces as a
# 502 or zod parse failure in the /bulk page.
#
# What's covered:
#   1. POST /v1/cache/batch/put
#      - text + base64-encoded + TTL'd items
#      - per-item failure surfaces (missing key, invalid base64)
#      - response shape: results[].{key,stored,bytes?,error?,code?}
#   2. POST /v1/cache/batch/get
#      - fetches all stored keys + one missing
#      - response shape: results[].{key,found,value?,value_encoding?,...}
#      - value round-trip: base64 → bytes matches what was stored
#   3. POST /v1/cache/batch/delete
#      - removes the test keys
#      - response shape: results[].{key,deleted,owners?,error?,code?}
#      - verification: subsequent batch/get returns all found=false
#   4. Edge cases:
#      - empty keys: [] returns { results: [], node: ... }
#      - missing-key "" produces per-item error, batch as a whole 200
#
# Usage:
#   ./scripts/smoke-bulk.sh
#   HYPERCACHE_API_URL=http://cache-1:8080 HYPERCACHE_TOKEN=admin-tok ./scripts/smoke-bulk.sh
#
# The script is idempotent: it generates a unique key prefix per
# run and cleans up its keys on exit (success OR failure) via a
# trap. Aborting mid-run with ^C also triggers cleanup.
#
# Exit codes:
#   0 — all assertions passed
#   1 — at least one assertion failed (operator gets the full report)
#   2 — pre-flight failed (curl/jq missing, server unreachable)

set -euo pipefail

readonly API_URL="${HYPERCACHE_API_URL:-http://localhost:8081}"
readonly TOKEN="${HYPERCACHE_TOKEN:-dev-token}"
# Per-request timeout — any single curl that exceeds this is
# treated as a hard failure rather than an indefinite hang.
# 15s is generous: a healthy batch/put of ~5 items finishes in
# tens of milliseconds; if we're at 15s the cluster is stuck or
# misrouted, not just busy.
readonly REQ_TIMEOUT="${HYPERCACHE_REQ_TIMEOUT:-15}"
# Settle delay between a write and the read that verifies it.
# A 5-node distributed cluster propagates replicas asynchronously
# (heartbeat 1s, rebalance 250ms in the default compose). PUTs
# complete on the primary, but the verification GET may forward
# to a peer that hasn't received the replica yet — the symptom
# is a `found: false` on a key the PUT phase reported `stored:
# true`. Half a second is plenty in a healthy 5-node cluster;
# bump for laggier setups via env.
readonly SETTLE_MS="${HYPERCACHE_SETTLE_MS:-500}"
# Split the assignment from the readonly declaration so a `date`
# failure isn't masked by the ALWAYS-zero-exit-code of `readonly`.
TIMESTAMP="$(date +%s)"
readonly TIMESTAMP
readonly PREFIX="smoke-bulk-${TIMESTAMP}-$$"

# Cumulative failure counter — every assertion runs even if an
# earlier one failed, so the operator gets one full report rather
# than discover-and-rerun. Mirrors the cache repo's smoke-test idiom.
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

# Pause for SETTLE_MS milliseconds. `sleep` accepts fractional
# seconds on every shell we target; the conversion is a one-liner.
# Centralized so a future tweak to the propagation model only
# touches one call site.
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

# Quick reachability probe — the server doesn't need auth on the
# OpenAPI spec endpoint, so failure here is clearly server-down
# rather than auth-misconfigured.
if ! curl -sS -o /dev/null --max-time "$REQ_TIMEOUT" "$API_URL/v1/openapi.yaml"; then
	printf 'pre-flight: cache server unreachable at %s\n' "$API_URL" >&2
	printf "hint: start a cluster with 'make start-dev-scaled' (sibling cache repo).\n" >&2
	exit 2
fi

log_info "API:    $API_URL"
log_info "prefix: $PREFIX"
echo

# ---- Cleanup trap ----------------------------------------------------

# shellcheck disable=SC2329  # invoked indirectly via the EXIT trap below
cleanup() {
	# Best-effort delete of every key the script may have touched.
	# Failures inside cleanup don't bump fail_count — the test was
	# already over by the time we got here.
	curl -sS -o /dev/null --max-time "$REQ_TIMEOUT" \
		-H "Authorization: Bearer $TOKEN" \
		-H "Content-Type: application/json" \
		-X POST \
		-d "{\"keys\": [\"${PREFIX}-text\", \"${PREFIX}-bin\", \"${PREFIX}-ttl\"]}" \
		"$API_URL/v1/cache/batch/delete" || true
}
trap cleanup EXIT

# ---- Test helpers ----------------------------------------------------

# post_json POST_PATH BODY
#
# Sets the global LAST_STATUS to the HTTP status code, or "000"
# on curl-level failure (timeout, connection refused). Body is
# written to /tmp/hyp-bulk-body.json.
#
# Why a global instead of stdout: the caller used to be
# `status=$(post_json ... | head -n1)`, which ran post_json in a
# subshell and (a) consumed every log_fail / log_info line into
# the pipe instead of the operator's terminal, hiding diagnostic
# output, and (b) lost any fail_count increments at subshell
# exit. The global-variable shape keeps log_fail visible AND
# preserves the cumulative failure tally.
LAST_STATUS=""
post_json() {
	local path="$1"
	local body="$2"
	log_info "→ POST $path (timeout ${REQ_TIMEOUT}s)"
	local curl_exit=0
	LAST_STATUS=$(curl -sS -o /tmp/hyp-bulk-body.json --max-time "$REQ_TIMEOUT" -w '%{http_code}' \
		-H "Authorization: Bearer $TOKEN" \
		-H "Content-Type: application/json" \
		-X POST \
		-d "$body" \
		"$API_URL$path") || curl_exit=$?
	if [[ $curl_exit -ne 0 ]]; then
		log_fail "curl failed (exit $curl_exit) on POST $path — likely timeout (>${REQ_TIMEOUT}s) or connection refused"
		: >/tmp/hyp-bulk-body.json
		LAST_STATUS="000"
	fi
}

# assert_status WANT GOT [TEST_NAME]
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

# assert_jq EXPR EXPECTED [TEST_NAME] — evaluates EXPR on
# /tmp/hyp-bulk-body.json and compares.
assert_jq() {
	local expr="$1"
	local want="$2"
	local name="${3:-jq assert}"
	local got
	got=$(jq -r "$expr" /tmp/hyp-bulk-body.json 2>/dev/null || echo '<jq error>')
	if [[ "$got" == "$want" ]]; then
		log_ok "$name → $got"
	else
		log_fail "$name: got '$got', want '$want'; body: $(cat /tmp/hyp-bulk-body.json)"
	fi
}

# ---- 1. batch/put ---------------------------------------------------

log_info "1. batch/put — three items + two error cases"

# "hello" base64 = aGVsbG8=
put_body=$(
	cat <<EOF
{
	"items": [
		{"key": "${PREFIX}-text", "value": "hello world"},
		{"key": "${PREFIX}-bin", "value": "aGVsbG8=", "value_encoding": "base64"},
		{"key": "${PREFIX}-ttl", "value": "with ttl", "ttl_ms": 60000},
		{"key": "", "value": "should-fail"},
		{"key": "${PREFIX}-bad-b64", "value": "!!!not-valid-base64!!!", "value_encoding": "base64"}
	]
}
EOF
)

post_json "/v1/cache/batch/put" "$put_body"
status="$LAST_STATUS"
assert_status "200" "$status" "batch/put returns 200 on partial-failure batch"
assert_jq '.results | length' "5" "batch/put returns 5 results"
assert_jq '[.results[] | select(.stored == true)] | length' "3" "3 items stored successfully"
assert_jq '[.results[] | select(.stored == false)] | length' "2" "2 items failed per-item"

# Per-item index assertions — these pin which items succeeded
# vs failed, not just the aggregate count. If the TTL'd item
# shows `stored: false` here, the GET-phase failure later
# downstream is just downstream of THIS bug; if it shows true,
# the bug is on the read path / propagation.
assert_jq '.results[0].key' "${PREFIX}-text" "PUT result[0] is the text key"
assert_jq '.results[0].stored' "true" "PUT text key stored"
assert_jq '.results[1].key' "${PREFIX}-bin" "PUT result[1] is the bin key"
assert_jq '.results[1].stored' "true" "PUT bin key stored"
assert_jq '.results[2].key' "${PREFIX}-ttl" "PUT result[2] is the TTL'd key"
assert_jq '.results[2].stored' "true" "PUT TTL'd key stored"
assert_jq '.results[2].owners | length >= 1' "true" "PUT TTL'd key has owners assigned"

# Per-item error semantics — the empty-key item must NOT halt the
# batch; the cache MUST surface a per-item error code.
assert_jq '.results[3].stored' "false" "empty key item flagged as not stored"
assert_jq '.results[3].code // empty' "BAD_REQUEST" "empty key item carries BAD_REQUEST code"
assert_jq '.results[4].stored' "false" "invalid-base64 item flagged as not stored"
echo

# Replication settle: PUT completes on each key's primary, but
# the upcoming GET may forward to a different peer that hasn't
# received the replica yet. Without this pause a healthy cluster
# can return `found: false` for a key the PUT phase already
# reported `stored: true`.
log_info "settling for ${SETTLE_MS}ms (replica propagation)"
sleep_settle
echo

# ---- 2. batch/get ---------------------------------------------------

log_info "2. batch/get — three found, one missing"

get_body=$(
	cat <<EOF
{
	"keys": ["${PREFIX}-text", "${PREFIX}-bin", "${PREFIX}-ttl", "${PREFIX}-does-not-exist"]
}
EOF
)

post_json "/v1/cache/batch/get" "$get_body"
status="$LAST_STATUS"
assert_status "200" "$status" "batch/get returns 200"
assert_jq '.results | length' "4" "batch/get returns 4 results (3 found + 1 missing)"
assert_jq '[.results[] | select(.found == true)] | length' "3" "3 keys found"
assert_jq '[.results[] | select(.found == false)] | length' "1" "1 key missing"

# Wire-encoding fidelity: the text key was stored as UTF-8 "hello world"
# (11 bytes); the cache returns it base64-encoded → "aGVsbG8gd29ybGQ=".
assert_jq '.results[0].value' "aGVsbG8gd29ybGQ=" "text key round-trips as base64"
assert_jq '.results[0].value_encoding' "base64" "text key carries value_encoding=base64"

# Owners array must be present + non-empty for distributed clusters.
# (Single-node clusters return one entry; both shapes are fine.)
assert_jq '.results[0].owners | length >= 1' "true" "owners array populated"

# TTL'd item carries ttl_ms (positive) + version (when present).
# `Version` on `batchGetResult` is JSON-tagged `omitempty` in
# `cmd/hypercache-server/main.go`, so items at version 0 are
# omitted from the response entirely — `.version` evaluates to
# null. Assert "either absent or a non-negative integer" rather
# than `>= 1`, which silently flunked items that were freshly
# inserted (version 0) on a long-running cluster.
assert_jq '.results[2].ttl_ms > 0' "true" "TTL'd item carries positive ttl_ms"
assert_jq '.results[2] | (has("version") | not) or (.version >= 0)' "true" \
	"TTL'd item version is non-negative when present"
echo

# ---- 3. Empty-keys edge case ---------------------------------------

log_info "3. batch/get with empty keys: [] — expect empty results"

post_json "/v1/cache/batch/get" '{"keys": []}'
status="$LAST_STATUS"
assert_status "200" "$status" "empty batch/get returns 200"
assert_jq '.results | length' "0" "empty batch/get returns empty results"
echo

# ---- 4. batch/delete ------------------------------------------------

log_info "4. batch/delete — three keys"

del_body=$(
	cat <<EOF
{
	"keys": ["${PREFIX}-text", "${PREFIX}-bin", "${PREFIX}-ttl"]
}
EOF
)

post_json "/v1/cache/batch/delete" "$del_body"
status="$LAST_STATUS"
assert_status "200" "$status" "batch/delete returns 200"
assert_jq '.results | length' "3" "batch/delete returns 3 results"
assert_jq '[.results[] | select(.deleted == true)] | length' "3" "all 3 keys deleted"
echo

# Same replica-propagation reasoning as before §2 — a delete on
# the primary may not yet have reached every peer; pause before
# verifying so we don't observe a transient `found: true`.
log_info "settling for ${SETTLE_MS}ms (delete propagation)"
sleep_settle
echo

# ---- 5. Cleanup verification ---------------------------------------

log_info "5. batch/get after delete — expect all missing"

post_json "/v1/cache/batch/get" "$get_body"
status="$LAST_STATUS"
assert_status "200" "$status" "post-delete batch/get returns 200"
assert_jq '[.results[] | select(.found == false)] | length' "4" "all 4 keys missing after delete"
echo

# ---- Summary --------------------------------------------------------

if [[ $fail_count -eq 0 ]]; then
	if [[ -t 1 ]]; then
		printf '\033[32mPASS\033[0m all batch-endpoint smoke checks succeeded.\n'
	else
		printf 'PASS all batch-endpoint smoke checks succeeded.\n'
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
