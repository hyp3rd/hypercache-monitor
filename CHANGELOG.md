# Changelog

All notable changes to this project. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version label visible in the app's sidebar footer is the
authoritative current version.

## [Unreleased]

## [0.10.0] — Phase C: auth.js v5 OIDC

Closes the Phase C roadmap with optional OIDC sign-in alongside
the existing operator-issued bearer flow. Operators can sign in
once at their IdP and present the issued access token to every
cluster; static-bearer logins remain valid for machine
integrations and break-glass use.

### Added

- **OIDC sign-in flow** — when `AUTH_OIDC_ISSUER` (plus
  `AUTH_OIDC_CLIENT_ID`, `AUTH_OIDC_CLIENT_SECRET`,
  `AUTH_SECRET`) are set, `/login` renders a "Sign in with
  &lt;provider&gt;" button above the existing token-paste form.
  Clicking it calls auth.js v5's `signIn("oidc", ...)` client
  helper, which posts the CSRF dance and redirects to the IdP.
  After the IdP returns, auth.js's callback hands off to a
  monitor-owned post-callback route at
  [/api/auth/oidc-callback](src/app/api/auth/oidc-callback/route.ts)
  that probes the chosen cluster's `/v1/me` with the IdP-issued
  access token and seals iron-session in the existing
  `{ token, identity, scopes }` shape — extended with
  `source: "oidc"` so logout knows to also clear auth.js's
  cookie. Single-IdP-across-all-clusters by design;
  per-cluster IdP federation is a deliberate non-goal.
- **Generic OIDC provider** — auth.js's `type: "oidc"`
  configured via `<issuer>/.well-known/openid-configuration`
  discovery, no hardcoded vendor. Verified against Keycloak,
  Auth0, Microsoft Entra, and Okta. Operators wire their
  IdP via `AUTH_OIDC_*` env vars validated in `src/env/server.ts`
  with a `superRefine` that rejects partial config.
- **Hybrid coexistence** — the static-bearer flow remains
  unchanged. The cache's `httpauth.Policy` resolve chain
  already handles bearer-fallthrough → ServerVerify, so a
  hybrid k8s deployment with both OIDC and static bearers
  configured serves both shapes against the same cluster.
- **Per-cluster logout** — `POST /api/auth/logout?cluster=<id>`
  drops just that cluster's session entry without destroying the
  whole iron-session cookie. Pairs with the existing query-less
  endpoint (whole-session destroy, unchanged). When the dropped
  cluster is the active one, the active is reassigned to the
  alphabetically-first remaining bound cluster; when no clusters
  remain bound, the cookie is destroyed. Idempotent on
  not-bound (returns `ok: true, removed: false`). Closes one
  of the lingering "still out of scope" items from the Phase
  C1 plan. The whole-session and per-cluster paths now also
  call auth.js's `signOut()` when an OIDC session was active,
  best-effort against the IdP's `end_session_endpoint`. 12
  unit tests in
  [route.test.ts](src/app/api/auth/logout/route.test.ts) cover
  every branch including the OIDC-source detection.

### Stopping conditions

- **Token refresh is a v2 follow-up.** Access tokens expire
  (typically 1h). When the iron-session-stored bearer goes stale,
  the cache returns 401 and the operator re-signs-in. Operators
  with short-lived IdP tokens (< 1h) will see frequent re-auth
  prompts. v2 will wire auth.js's JWT-callback refresh hook plus
  a proactive re-seal in iron-session before each upstream
  forward.
- **RP-initiated single sign-out** is best-effort — works when
  the IdP advertises `end_session_endpoint` in its discovery doc.
  Otherwise local-only logout. Documented in the auth.js docs.
- **next-auth v5** is technically still on the beta tag at the
  time of release (5.0.0-beta.31). It has been beta-stable for
  18+ months and is the App Router-native default in every
  current auth.js doc — verified via
  [authjs.dev](https://authjs.dev/getting-started/installation).
  The v4 line is Pages-Router-only. We pin the explicit beta
  range in package.json.
- **AUTH_URL pin in tests.** Auth.js v5 builds the OIDC
  `redirect_uri` from the request's `Host` header. Some
  Node.js HTTP layers normalize between `127.0.0.1` and
  `localhost` in generated URLs, breaking the host-scoped
  PKCE/state cookies on the callback. Our Playwright config
  pins `AUTH_URL=http://localhost:3100` and runs E2E
  on `localhost` throughout. Production deployments should set
  `AUTH_URL` to their canonical public URL.

### Changed

- `trustHost: true` unconditionally in `src/lib/auth/oidc.ts`.
  Auth.js v5's CSRF gate enforces trustHost on POST /signin;
  every supported deployment terminates TLS at a known proxy
  or runs on localhost. Operators who need stricter Host
  validation should put a WAF in front of the monitor.
- E2E sign-in selectors switched to `name: /^Sign in$/i` to
  disambiguate from the OIDC button when both render. The
  selector behavior is identical for OIDC-disabled
  deployments.

### Verified

- `make ci` clean (vitest 24 files / 213 tests, ESLint, tsc,
  audit, build).
- `CI=1 make e2e` clean — all 24 E2E specs pass on the static-
  bearer flow plus the new
  [oidc.spec.ts](tests/e2e/oidc.spec.ts) drives the full IdP
  roundtrip against an in-process
  [oidc-stub](tests/e2e/fixtures/oidc-stub.ts) (RS256-signed
  JWTs, real `/.well-known/openid-configuration` + JWKS +
  authorize + token endpoints).

## [0.9.0] — Phase C: SSE live topology

Replaces `/topology`'s 2-second polling cadence with a live
Server-Sent Events stream from the cache's new `GET /cluster/events`
endpoint. Polling remains as the disconnect fallback so a transient
proxy timeout doesn't blank the page.

### Added

- **`useTopologyEvents` hook**
  ([src/lib/topology/use-topology-events.ts](src/lib/topology/use-topology-events.ts))
  opens an EventSource against the cluster-aware proxy URL
  (`/api/clusters/[id]/mgmt/cluster/events`), parses `members`
  and `heartbeat` frames with the same zod schemas the polling
  fetcher uses, and writes parsed snapshots into TanStack
  Query's cache via `setQueryData`. One source of truth — every
  existing render path on `/topology` reads from the same
  store regardless of whether the data arrived via SSE or
  polling. Reconnect with exponential backoff, visibility-aware
  close/reopen, hard-disable via `enabled: false`. 9 unit
  tests cover open/close/parse/schema-fail/cluster-swap.
- **Polling fallback** in
  ([topology-client.tsx](<src/app/(app)/topology/_components/topology-client.tsx>))
  — when the hook reports `connected: true`, the `members` and
  `heartbeat` queries set `refetchInterval: false` (no double-
  fetching). On SSE disconnect, polling resumes within the
  visibility-aware interval. The ring polls regardless of SSE
  state because vnode hashes only change on membership transitions
  (which the `members` event captures structurally).
- **Cache-stub SSE handler**
  ([cache-stub.ts](tests/e2e/fixtures/cache-stub.ts)) — new
  `/cluster/events` branch that streams the same wire shape the
  production cache emits. Initial frames at connect, plus a 1 Hz
  `heartbeat` tick until the client disconnects.
- **E2E coverage** in
  ([topology.spec.ts](tests/e2e/topology.spec.ts)) — new
  scenario asserts the EventSource opens against the cluster-aware
  proxy URL on /topology mount.

### Notes

- The cache repo's matching `GET /cluster/events` SSE handler
  landed in its own CHANGELOG entry; this monitor relies on the
  cache's `/cluster/events` to be present. A pre-Phase-C cache
  binary 404s the request — the EventSource fires `error`, the
  hook's reconnect loop kicks in with exponential backoff, and
  polling fills the gap. So mismatched-version deployments
  degrade gracefully instead of breaking the page.
- The proxy
  ([src/lib/api/proxy.ts:199](src/lib/api/proxy.ts)) already
  passed streaming responses through unchanged
  (`new Response(upstream.body)`), so the catch-all mgmt route
  required no refactor — the SSE response body streams from
  cache → Next proxy → browser without buffering.
- EventSource API doesn't support custom headers (`Authorization`
  is rejected), but the iron-session cookie travels with the
  request automatically. The proxy reads the cookie, retrieves
  the bearer, and injects `Authorization: Bearer X` on the
  cache-side request — exactly the same auth flow polling uses.

## [0.8.0] — Phase C: Eviction Controls UI

The cluster-mutating control surface — evict, trigger-expiration,
clear — is now LIVE. Phase A's unconditional 501 gate has been
retired in favor of real per-end enforcement: cache-side admin
scope on the mgmt port (cache repo) and monitor-side
session-scope check (post-C2 sealed real scopes from `/v1/me`).
Minor-bump because the control endpoints transition from
"shipped + dark" to "shipped + lit" — same surface, behavior change.

### Added

- **`/admin` page** with three destructive controls — Trigger
  Eviction, Trigger Expiration, Clear cluster. Each wraps a
  shadcn `<AlertDialog>` confirm with a per-control body that
  conveys reversibility (sweeps reclaim by policy; Clear is
  irreversible). Card colour: amber for sweeps, destructive-red
  for Clear. Sonner toast on success / failure.
- **Sidebar "Administration" section** in `src/app/(app)/layout.tsx`,
  conditionally rendered when `auth.session.scopes.includes("admin")`.
  Hidden ≠ secure: the page does its own scope check and the
  proxy enforces admin on every POST regardless of what the
  sidebar shows.
- **E2E coverage** in `tests/e2e/admin.spec.ts`: Cancel-without-fetch,
  Trigger Eviction (POST `/evict` returns 202), Clear cluster
  (POST `/clear` returns 200, with the irreversibility warning
  visible in the dialog), and an axe-clean closed-state scan.

### Changed

- **`src/app/api/clusters/[clusterId]/mgmt/control/[op]/route.ts`** —
  the unconditional 501 + `HYPERCACHE_MONITOR_ENABLE_ADMIN_OPS`
  env gate is **gone**. The route now forwards every allowed op
  to `proxyToCache(req, { target: "mgmt", path, requiredScope:
"admin" })`, relying on the post-C2 sealed real scopes plus
  the cache-side `WithMgmtControlAuth` enforcement (cache CHANGELOG).
- **`HYPERCACHE_MONITOR_ENABLE_ADMIN_OPS` env var retired.** It
  was a defense-in-depth belt while the cache mgmt port had no
  server-side enforcement. With both ends now checking admin
  scope it's belt-and-suspenders we don't need. Operators
  setting it in their k8s manifests can drop it; reading the
  variable does nothing now.
- **Cache stub extended** (`tests/e2e/fixtures/cache-stub.ts`)
  with `/evict`, `/trigger-expiration`, `/clear` handlers
  matching the production binary's response shapes (202 for
  fire-and-forget, 200 for `/clear`).

### Notes

- The cache repo's matching `WithMgmtControlAuth` work landed in
  its own CHANGELOG entry; deploying this monitor against a
  pre-Phase-C2 cache binary is safe (the proxy's session-scope
  check 403s read-only operators before fetch) but loses the
  cache-side defense layer. Operators should upgrade both.
- Per-cluster logout still out of scope.
- Server-rendered scope check on `/admin` page returns a clean
  "insufficient scope" panel rather than redirecting — operators
  who land here from a deep link see what's missing without
  silent bounces.

## [0.7.1] — Phase C2: Real identity, hostname defaults, live reload

Closes the four items deferred from C1. Single-cluster deployments
remain back-compatible. Multi-cluster deployments gain real per-
cluster identity, hostname-aware login defaults, and YAML edits
that propagate without restart.

### Added

- **`GET /v1/me` login probe.** `src/app/api/auth/login/route.ts`
  now probes the cache's new `/v1/me` endpoint instead of the
  legacy two-step `/v1/openapi.yaml` + `/v1/owners/__probe__`
  flow. The cache returns the operator's resolved identity and
  the actual scopes the bound credential carries; the session
  cookie is sealed with those real values. The Phase A/B
  optimistic `["read","write","admin"]` grant is gone — the
  proxy's scope check (`src/lib/api/proxy.ts:72`) becomes
  correct rather than accidentally permissive. Pre-Phase-C2
  cache binaries that don't expose `/v1/me` 404 the probe;
  the route surfaces a clear "cache server too old" error
  instead of generic `UPSTREAM_FAILURE`. New zod schema uses
  `.passthrough()` for forward-compat with future cache fields.
  15 unit tests in `route.test.ts` (happy path, malformed body,
  401/403/404/5xx, illegal clusterId, cross-cluster sealing).
- **Hostname-aware default cluster on `/login`.** Each cluster
  in `clusters.yaml` may include an optional `hosts: [...]`
  allowlist. The `/login` server component now reads the request
  `Host` header (port-stripped, lowercased) and preselects the
  matching cluster in the dropdown. Resolution precedence:
  `?cluster=` query param > Host-header match > first cluster.
  Loader rejects ambiguous configurations (two clusters claiming
  the same host) at boot. Hostnames must be bare lowercase
  strings — no scheme, no port. The Host header is **never**
  consulted in any auth gate; this is purely a UX default.
- **Live `clusters.yaml` reload.** The registry is now stateful;
  `fs.watchFile` polls the YAML at 2-second intervals, atomically
  swaps the registry on a successful re-parse, and **keeps the
  previous valid map** when the reload fails (bad YAML, removed
  file, schema violation). Operators can edit `clusters.yaml`
  in place — adding clusters, removing clusters, fixing typos —
  without restarting the monitor. 7 new unit tests in
  `registry.test.ts` exercise the reload path through a
  `__test_reloadFromPath` seam (no real fs.watch in tests).
- **Multi-cluster E2E scenario** (`tests/e2e/multi-cluster.spec.ts`).
  Spins up TWO cache stub instances on disjoint port pairs
  (`STUB_API_PORT_B=3403`, `STUB_MGMT_PORT_B=3404`), writes a
  temp `clusters.yaml` at config-load time mapping cluster ids
  `default`/`secondary` to the two stubs, and drives the full
  cross-cluster flow: login on default → click secondary in
  picker → 401 NEED_LOGIN → redirect to `/login?cluster=secondary`
  → login → topbar identity flips to `stub-B` → switch back to
  default in picker → topbar flips to `stub-A` → logout. Each
  stub's `/v1/me` returns a distinguishable identity so the
  topbar flip is observable in the DOM.

### Changed

- `src/lib/clusters/types.ts` — `Cluster` interface gains
  optional `hosts?: readonly string[]`.
- `src/lib/clusters/loader.ts` — zod schema extended with
  hostname validation; `superRefine` enforces cross-cluster
  hostname uniqueness.
- `src/lib/clusters/registry.ts` — refactored from a frozen
  `const registry` to a mutable `let current` with `fs.watchFile`-
  driven reloads. Public API (`getCluster`, `listClusters`,
  `DEFAULT_CLUSTER_ID`) is unchanged. Build-phase guard preserved.
  Hot-reload safety in dev via `globalThis.__hypercacheClustersWatcher`.
- `tests/e2e/fixtures/cache-stub.ts` — `startCacheStub` now
  takes optional `{ apiPort, mgmtPort, identity }` so the same
  stub code can spawn N instances. Existing single-cluster
  scenarios continue to work because the default args match the
  previous fixed values exactly.
- `playwright.config.ts` — webServer env switched from
  `HYPERCACHE_API_URL`/`HYPERCACHE_MGMT_URL` pair to
  `HYPERCACHE_MONITOR_CLUSTERS` pointing at the temp YAML.
  Existing 14 single-cluster specs continue to work because
  the YAML's first cluster id is still `default`.

### Notes

- The cache repo's matching `GET /v1/me` work landed in its own
  CHANGELOG entry; the monitor's C2 changes assume operators
  upgrade the cache binary alongside the monitor. Mismatched
  versions surface clearly via the `404 → "cache server too old"`
  error path.
- Per-cluster logout still out of scope — `/api/auth/logout`
  destroys the whole session.
- Iron-session 4 KB cookie ceiling unchanged; sealing real
  scopes (often 1-2 entries) makes the cookie _smaller_ on
  average than the legacy three-element grant.

## [0.7.0] — Phase C1: Multi-cluster registry

First Phase C deliverable. The session shape, proxy URL layout, and
TanStack queryKeys were already cluster-keyed from Phase A; C1 lights
up the wiring: a YAML registry, per-cluster login binding, an
interactive cluster picker, and a switch-cluster route. Single-cluster
deployments need no config change — the env-var fallback synthesizes
the same `default` entry they had before.

### Added

- `HYPERCACHE_MONITOR_CLUSTERS`: optional path to a YAML file mapping
  cluster id → `{ name, apiBaseUrl, mgmtBaseUrl }`. Parsed once at boot
  by `src/lib/clusters/loader.ts` (zod-validated, frozen output).
  See `clusters.example.yaml` for the full shape.
- `POST /api/auth/switch-cluster`: flips `session.activeClusterId` to
  a cluster the operator has already authenticated against. Returns
  `401 NEED_LOGIN` with the cluster id when no session is bound,
  letting the picker route the operator to `/login?cluster=<id>`.
- Login form gains a cluster `<Select>` when the registry has more
  than one entry; the chosen cluster id rides along in the POST body.
  Single-cluster deployments see the form unchanged.
- Cluster picker is now interactive: clicking an "Other clusters"
  entry POSTs to `/api/auth/switch-cluster`; on 200 the page refreshes
  against the new active cluster, on 401 the operator is redirected
  to `/login?cluster=<id>`.

### Changed

- `HYPERCACHE_API_URL` / `HYPERCACHE_MGMT_URL` are now optional in
  `src/env/server.ts`; the cluster loader enforces "at least one
  source is configured" with a clearer error than zod's per-field
  message. When both YAML and env-pair are set, YAML wins and the
  env-pair is ignored (warning logged at boot).
- `/api/auth/login` accepts `{ token, clusterId? }`. When omitted,
  defaults to `DEFAULT_CLUSTER_ID` for back-compat with the Phase
  A/B single-cluster form. The selected cluster's URL is probed
  (not always `default`), and the session is sealed under that
  cluster's key.

### Notes

- Per-cluster identity from a `/v1/me`-style endpoint is **out of
  scope** for C1; identity continues to default to the cluster id
  until the cache exposes that endpoint (Phase C2).
- Cluster config is read once at boot — operators restart the
  monitor process to pick up `clusters.yaml` changes. Live reload
  is intentionally deferred.
- The session cookie's iron-session 4 KB ceiling implies a practical
  ~15-20 cluster cap per operator session. Hostname-based routing
  and server-side session storage are Phase C2 territory.

## [0.6.0] — Phase B complete

Phase B finalization: B4 (Auth posture) and B5 (Live API spec)
ship together; Phase B is now fully delivered.

### Added

- `/auth-info` (B4): read-only audit surface displaying the operator's
  bound identity, granted scopes (with a permissions matrix listing
  every scope's concrete actions), and the cache server's advertised
  `securitySchemes` from `/v1/openapi.yaml`. The bearer token sealed
  in the iron-session cookie is **never** displayed — verified by an
  E2E assertion (`tests/e2e/auth-info.spec.ts`) that scans the rendered
  body text for the test token.
- `/spec` (B5): live OpenAPI 3.x spec viewer. Filters write operations
  (POST/PUT/PATCH/DELETE) out of the rendered docs server-side via
  `filterToSafeMethods` — operators see read-method documentation
  inline; writes are routed through Single-Key Inspector / Bulk where
  destructive ops are explicitly confirmed. Native shadcn renderer
  (no third-party doc widget); see `src/app/(app)/spec/_components/
spec-viewer.tsx` for the rationale of the choice.
- Hygiene: `scripts/smoke-keys.sh` + `scripts/smoke-mgmt.sh` —
  symmetric wire-contract probes against a live cluster's single-key
  and management endpoints. `make smoke` runs all three smoke scripts;
  `make smoke-keys` / `make smoke-mgmt` / `make smoke-bulk` run them
  individually. Not part of `make ci` — they need an external cluster.
- Hygiene: `package.json` `overrides` pinning `postcss ^8.5.10` —
  closes [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93)
  ahead of an upstream Next bump; PostCSS 8.x is API-stable across
  8.4 → 8.5 so Next's CSS pipeline is unaffected.

### Changed

- E2E web server moved from `:3000` to `:3100` so it can never
  collide with `npm run dev` for visual review (`playwright.config.ts`).
  The previous setup with `reuseExistingServer: !CI` would silently
  reuse the operator's dev server, producing 13/14 confusing E2E
  failures with no clear root cause.

## [0.5.0] — Phase B3: Bulk operations

### Added

- `/bulk`: three-tab page (Fetch / Put / Delete) for batch operations.
  CSV import for bulk PUT with header-required RFC 4180 parser, multi-key
  fetch with CSV download, bulk delete with two-step confirmation
  dialog. Requests are chunked at 1,000 items per request and stream
  per-item results into a TanStack Table v8 (sortable, filterable,
  paginated at 50 rows/page).
- `scripts/smoke-bulk.sh`: end-to-end wire-contract probe against
  the cache's `/v1/cache/batch/{get,put,delete}` endpoints. Discovered
  the cache-side bug where TTL'd items lost `LastAccess` during
  replication, fixed in the cache repo at the same time.

## [0.4.0] — Phase B2: Metrics dashboard

### Added

- `/metrics`: real-time observability surface polling `/stats`,
  `/config`, and `/dist/metrics` at 5s active / 30s idle. Cumulative
  counters flow into per-field ring buffers; the page renders
  rate-of-second sparklines via Recharts (lazy-loaded shadcn `chart`
  component). Counter-reset detection produces null-rate gaps in the
  chart rather than negative spikes.

## [0.3.0] — Phase B1: Single-Key Inspector

### Added

- `/keys`: per-key inspector with live `?k=` URL state. Supports
  PUT, GET, HEAD, DELETE on a single key with TTL picker (Go-duration
  syntax), value display in Text / Hex / Base64 tabs with byte
  download, and owners strip from `/v1/owners/{key}`. Two-step
  delete confirmation via shadcn AlertDialog.

## [0.2.0] — Phase A finalization

### Added

- `Makefile` quality-gate contract: `make ci` runs the full
  `fmt-check + lint + typecheck + test + sec + build` pipeline
  per AGENTS.md §4. Individual targets (`make lint`, `make test`,
  etc.) for iteration.
- Vitest unit tests + Playwright E2E with axe-core a11y checks.
- `next/font/google` self-hosted Roboto family (sans / serif / mono)
  via CSS variables. Avoids the FOUC + GDPR-ish CDN-call shape that
  client-side font loaders carry.
- ESLint flat config, Prettier with `prettier-plugin-tailwindcss`,
  CI workflow at `.github/workflows/ci.yml`.

### Fixed

- Env validation in `src/env/server.ts` skips the strict zod parse
  during `NEXT_PHASE === 'phase-production-build'` — page-data
  collection at build time doesn't have runtime secrets, and the
  re-evaluated module on each fresh Node process at runtime still
  fails-fast on missing env. Fixes the Docker image build that
  was previously crashing with "HYPERCACHE_API_URL: expected string,
  received undefined".

## [0.1.0] — Phase A: Bootstrap + Topology

### Added

- Next.js 16 + React 19 + TypeScript strict scaffolding with the
  shadcn/ui component library on Tailwind v4.
- iron-session v8-sealed bearer-token auth shell with `httpOnly` +
  `SameSite=Strict` + `Secure` (production) cookie. Server-side
  proxy at `/api/clusters/[clusterId]/{api,mgmt}/[...path]` injects
  the bearer from the sealed cookie into the upstream request;
  the token is never in browser-readable JS state.
- `/topology`: read-only live cluster view. Members table, hash-ring
  SVG visualization (320 vnodes), heartbeat success-rate hero card.
  Polls `/cluster/members`, `/cluster/ring`, `/cluster/heartbeat`
  via TanStack Query at 2s active / 30s idle (visibility-aware).
- Initial CSRF defense: `Sec-Fetch-Site` primary signal with
  `Origin/Host` fallback. Same-origin mutating requests pass; any
  `cross-site` value 403s.
- Multi-cluster URL shape baked in from day 1
  (`/api/clusters/[clusterId]/...` everywhere); the registry is
  single-cluster in Phase A but the surface is ready for Phase C
  config-file expansion.

[0.6.0]: https://github.com/hyp3rd/hypercache-monitor/releases/tag/v0.6.0
[0.5.0]: https://github.com/hyp3rd/hypercache-monitor/releases/tag/v0.5.0
[0.4.0]: https://github.com/hyp3rd/hypercache-monitor/releases/tag/v0.4.0
[0.3.0]: https://github.com/hyp3rd/hypercache-monitor/releases/tag/v0.3.0
[0.2.0]: https://github.com/hyp3rd/hypercache-monitor/releases/tag/v0.2.0
[0.1.0]: https://github.com/hyp3rd/hypercache-monitor/releases/tag/v0.1.0
