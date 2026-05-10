# HyperCache Monitor

Operator control panel for [HyperCache](https://github.com/hyp3rd/hypercache)
distributed cache clusters. **v0.10.0 · Phase C complete** — every operator
surface is shipped: multi-cluster registry, live SSE topology, Eviction
Controls (admin-scoped), per-cluster identity from `/v1/me`, hostname-
default cluster routing, per-cluster logout, and optional auth.js v5 OIDC
sign-in alongside the existing operator-issued bearer flow.

## Architecture

```text
   ┌──────────┐    sealed cookie    ┌──────────────┐    bearer + scope    ┌──────────────┐
   │  Browser │────────────────────▶│  Next.js 16  │─────────────────────▶│   HyperCache │
   │          │                     │  (this app)  │                      │   :8080 API  │
   └──────────┘                     │              │                      │   :8081 Mgmt │
                                    │  iron-session│                      └──────────────┘
                                    │  proxy       │
                                    └──────────────┘
```

The browser **never** addresses the cache directly — three reasons:

1. **CORS is absent** on both cache listeners. Browser → cache fails out of the box.
1. **Bearer-in-browser is XSS-readable**. The only safe shape for a financial-environment
   panel is an httpOnly session cookie sealed by [iron-session](https://github.com/vvo/iron-session).
1. **Admin-scope gating** is enforced in two places: the cache's
   management port enforces `admin` scope server-side on `/evict` /
   `/clear` / `/trigger-expiration` (shipped in Phase C, see the cache
   repo's per-route policy enforcement); the monitor's proxy still
   gates the same scope client-side, so a read-only token never reaches
   the upstream mutating routes through the UI.

Every request flows: browser → Next.js edge proxy
([src/proxy.ts](src/proxy.ts)) gates the session → API route
([src/lib/api/proxy.ts](src/lib/api/proxy.ts)) attaches the bearer token from the
sealed cookie + injects an `X-Request-Id` for cross-process correlation.

## Stack

- **Next.js 16** App Router + React 19 + TypeScript strict
  (`noUncheckedIndexedAccess`, `noImplicitOverride`, `isolatedModules`)
- **shadcn/ui + Tailwind v4** (CSS-first config, no `tailwind.config.js`)
- **iron-session v8** for the per-cluster session bindings
- **auth.js v5** (next-auth) for the optional OIDC sign-in flow,
  layered alongside the static-bearer paste form
- **TanStack Query v5** for client-side polling fallback (Topology
  uses SSE first; metrics + bulk + key inspector poll at 2s / 30s)
- **EventSource** (browser-native) for the Topology live updates
- **Recharts** via shadcn/ui charts for the Metrics dashboard
- **TanStack Table v8** for the Bulk-operations results tables
- **Hey API** (`@hey-api/openapi-ts`) for typed clients off the cache's OpenAPI 3.1 spec
- **Vitest + Playwright + axe-core** for tests
- Self-hosted **Roboto / Roboto Slab / Roboto Mono** via `next/font/google`

## Prerequisites

- Node 25 (or current LTS). Pinned in [.nvmrc](.nvmrc) and
  [package.json#engines](package.json).
- A running HyperCache cluster — see the
  [cache repo's quickstart](https://github.com/hyp3rd/hypercache).
  Local 5-node cluster: `make start-dev-scaled`
  (requires a sibling checkout of the cache repo).

## Quick start

```bash
nvm use            # Node 25
npm ci             # frozen install from package-lock
cp .env.example .env.local   # see "Environment" below; create this manually
make dev           # next dev on :3000
```

Open <http://localhost:3000> and sign in. Two shapes coexist:

- **Static bearer (always available)** — paste the token your cache
  operator issued (matches an entry in `HYPERCACHE_AUTH_CONFIG` on the
  server). Suited for machine integrations, break-glass, and CI.
- **OIDC sign-in (when `AUTH_OIDC_ISSUER` is set)** — a "Sign in with
  &lt;provider&gt;" button renders above the form and runs the auth.js v5
  redirect flow against your IdP (Keycloak, Auth0, Microsoft Entra,
  Okta, or any standards-compliant OIDC provider). The IdP-issued
  access token is sealed into the same iron-session shape as a pasted
  bearer; downstream proxy code is unaware of the source.

Either path lands on Topology.

### Try OIDC end-to-end without configuring an IdP

[`examples/oidc/`](examples/oidc/) ships a self-contained Docker stack:
a 5-node HyperCache cluster + a pre-seeded Keycloak realm + the
Monitor, all wired together. Bring it up with one command:

```bash
make start-oidc          # builds + starts the full stack
make oidc-logs           # tail logs
make stop-oidc           # stop (preserves Keycloak state)
make clean-oidc          # full teardown including volumes
```

Three test users are pre-created (`admin`/`admin`, `ops`/`ops`,
`viewer`/`viewer`) covering every scope combination the cache
understands. See [examples/oidc/README.md](examples/oidc/README.md)
for the operator guide and the one-time `/etc/hosts` step.

## Environment

Validated at boot via zod ([src/env/server.ts](src/env/server.ts)) — the
process refuses to start on any missing or malformed value.

| Variable                              | Required        | Description                                                                                                                                                                          |
| ------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HYPERCACHE_MONITOR_CLUSTERS`         | conditional     | Path to a YAML cluster registry (see [Multi-cluster registry](#multi-cluster-registry)). When set, overrides the URL pair below.                                                     |
| `HYPERCACHE_API_URL`                  | conditional     | Single-cluster fallback: client API base URL (e.g. `http://cache:8080`). Required when `HYPERCACHE_MONITOR_CLUSTERS` is unset.                                                       |
| `HYPERCACHE_MGMT_URL`                 | conditional     | Single-cluster fallback: management HTTP base URL (e.g. `http://cache:8081`). Required when `HYPERCACHE_MONITOR_CLUSTERS` is unset.                                                  |
| `IRON_SESSION_SECRET`                 | yes             | Cookie sealing key, ≥ 32 chars. Generate with `openssl rand -base64 48`.                                                                                                             |
| `IRON_SESSION_COOKIE_NAME`            | no              | Defaults to `hcm_session`. Override only for multi-instance hosts.                                                                                                                   |
| `BASE_URL`                            | no              | Next.js `basePath` (e.g. `/web` for OpenShift sub-path routing). Defaults to `/`.                                                                                                    |
| `HYPERCACHE_MONITOR_ENABLE_ADMIN_OPS` | no              | When `"true"` AND session has `admin` scope, enables the eviction control proxy. Off by default — see [Eviction Controls](#eviction-controls) below.                                 |
| `AUTH_OIDC_ISSUER`                    | OIDC: yes       | OIDC IdP issuer URL. Auth.js fetches `<issuer>/.well-known/openid-configuration` on first sign-in. When unset, OIDC is disabled and the login page is byte-identical to pre-Phase-C. |
| `AUTH_OIDC_CLIENT_ID`                 | OIDC: yes       | OAuth2 client ID registered at the IdP.                                                                                                                                              |
| `AUTH_OIDC_CLIENT_SECRET`             | OIDC: yes       | OAuth2 client secret registered at the IdP.                                                                                                                                          |
| `AUTH_OIDC_SCOPES`                    | no              | Space-separated scopes requested at `/authorize`. Defaults to `openid profile email`.                                                                                                |
| `AUTH_OIDC_PROVIDER_NAME`             | no              | Display name in the "Sign in with X" button. Defaults to `Identity Provider`.                                                                                                        |
| `AUTH_SECRET`                         | OIDC: yes       | auth.js JWT-session signing secret, ≥ 32 chars. Generate with `openssl rand -base64 48`.                                                                                             |
| `AUTH_URL`                            | OIDC: prod: yes | Canonical URL of the monitor (e.g. `https://monitor.example.com`). Pin this for proxied / TLS-terminated deployments so OIDC `redirect_uri` stays host-stable.                       |

At least one cluster source must be configured: either
`HYPERCACHE_MONITOR_CLUSTERS` (recommended) or both
`HYPERCACHE_API_URL` + `HYPERCACHE_MGMT_URL`. If both are set, the
YAML wins and the env-pair is ignored (logged at boot).

OIDC config is all-or-nothing: zod's `superRefine`
([src/env/server.ts](src/env/server.ts)) rejects partial `AUTH_OIDC_*`
configurations at boot — the monitor refuses to start rather than
render an OIDC button that 500s the moment an operator clicks it.

### Multi-cluster registry

For multi-cluster operation, point `HYPERCACHE_MONITOR_CLUSTERS` at
a YAML file mapping cluster id → metadata. See
[`clusters.example.yaml`](clusters.example.yaml) for the full shape:

```yaml
default:
  name: "Local cluster"
  apiBaseUrl: "http://cache:8080"
  mgmtBaseUrl: "http://cache:8081"
prod-eu:
  name: "Production EU"
  apiBaseUrl: "https://cache-eu.example.com"
  mgmtBaseUrl: "https://cache-eu.example.com:8081"
```

Cluster ids must match `[a-zA-Z0-9_-]+` — they appear in proxy
URLs and TanStack queryKeys. The login form renders a cluster
`<Select>` when more than one cluster is registered; the topbar
picker flips between clusters the operator has authenticated
against. Each cluster requires a separate token (issued by that
cluster's `HYPERCACHE_AUTH_CONFIG`); switching to a cluster the
session has not bound credentials for redirects to
`/login?cluster=<id>`.

**Hostname-aware default (Phase C2).** Each entry may include an
optional `hosts: [...]` allowlist of bare hostnames (lowercase, no
scheme, no port). When the monitor serves multiple hostnames from a
single binary, the matching `Host` header on `/login` preselects
that cluster in the picker. Two clusters cannot claim the same
host (loader rejects at boot). The Host header is never consulted
in any auth gate — purely a UX default; operators always pick
freely from the dropdown.

**Live reload (Phase C2).** The YAML file is `fs.watchFile`-polled
on a 2-second interval. Edits propagate to the running monitor
without a restart. Bad parses (typo, duplicate host, removed file)
log to stderr and keep the previous valid registry — operators
iterate without bringing the monitor down. Single-cluster
deployments need no YAML and keep working with the legacy
`HYPERCACHE_API_URL` / `HYPERCACHE_MGMT_URL` pair.

**Per-cluster identity (Phase C2).** The login flow probes
`GET /v1/me` on the selected cluster. The cache returns the
operator's resolved identity (token ID or mTLS subject CN) and
the actual scopes the bound credential carries — no more optimistic
three-scope grants. Pre-Phase-C2 cache binaries return 404 on
`/v1/me`; the monitor surfaces a clear "cache server too old"
error instead of a generic upstream failure.

## Quality gates

The [Makefile](Makefile) is the contract per
[AGENTS.md](.claude/CLAUDE.md) §4. Before declaring a task done:

```bash
make ci    # fmt-check + lint + typecheck + test + sec + build
make e2e   # Playwright + axe-core a11y
```

Individual gates while iterating:

| Target           | Purpose                                                     |
| ---------------- | ----------------------------------------------------------- |
| `make fmt`       | Auto-format with Prettier.                                  |
| `make fmt-check` | Verify formatting (CI-friendly).                            |
| `make lint`      | ESLint flat config.                                         |
| `make typecheck` | `tsc --noEmit`.                                             |
| `make test`      | Vitest unit + component tests (213 tests across 24 files).  |
| `make e2e`       | Playwright + axe-core (24 scenarios across 9 spec files).   |
| `make sec`       | `npm audit --audit-level=high`.                             |
| `make build`     | Production build (`next build`, standalone output).         |
| `make codegen`   | Regenerate the typed OpenAPI client from a running cluster. |

CI runs `make ci` and `make e2e` separately
([.github/workflows/](.github/workflows/)) so a flaky browser test doesn't block lint signal.

## Eviction Controls

`POST /evict`, `POST /clear`, `POST /trigger-expiration` on the cache's
management port require `admin` scope server-side as of Phase C. The
UI's proxy
([src/app/api/clusters/\[clusterId\]/mgmt/control/\[op\]/route.ts](src/app/api/clusters/%5BclusterId%5D/mgmt/control/%5Bop%5D/route.ts))
adds a second gate: it 501s by default, and only forwards when both
flags align —

- `HYPERCACHE_MONITOR_ENABLE_ADMIN_OPS=true` is set on the monitor, AND
- the operator's session carries `admin` scope.

A read-only token can never reach the upstream mutating routes through
the UI even with the env flag on; the cache's per-route policy is
the authoritative gate. The monitor flag exists so air-gapped or
read-only deployments can hide the controls entirely.

## Roadmap

| Phase  | Surfaces                                                                                                                                                                                                              | Status  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **A**  | Bootstrap + auth shell + **Topology** (members / ring / heartbeat)                                                                                                                                                    | shipped |
| **B1** | Single-Key Inspector (`/keys`)                                                                                                                                                                                        | shipped |
| **B2** | Metrics dashboard (`/metrics`) — sparklines + ring-buffer rate math                                                                                                                                                   | shipped |
| **B3** | Bulk operations (`/bulk`) — chunked CSV import + multi-key fetch + bulk delete                                                                                                                                        | shipped |
| **B4** | Auth posture viewer (`/auth-info`) — identity, scopes, OpenAPI security schemes                                                                                                                                       | shipped |
| **B5** | Live API spec viewer (`/spec`) — read-only docs renderer                                                                                                                                                              | shipped |
| **C**  | Multi-cluster registry, hostname-default routing, live YAML reload, per-cluster identity from `/v1/me`, SSE topology, Eviction Controls, per-cluster logout, identity introspection (`/v1/me`), auth.js v5 OIDC flow. | shipped |
| **v2** | Token refresh hook for OIDC (auth.js JWT-callback + iron-session re-seal), per-cluster IdP federation, hostname-per-cluster cookie scoping.                                                                           | future  |

For wire-contract verification against a live cluster, see
[`scripts/`](scripts/) — `smoke-bulk.sh` exercises the batch endpoints end
to end. Run as `make smoke-bulk` after `make start-dev-scaled`.

## Auth posture

| What           | Where                                                                                                                                | Posture                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI ↔ cache     | Bearer token — either operator-issued out-of-band (matches an entry in the cache's `HYPERCACHE_AUTH_CONFIG`) or IdP-issued via OIDC. | Sealed in iron-session cookie with a `source: "static"` or `source: "oidc"` marker; never reaches the browser as JS-readable state.                                        |
| OIDC sign-in   | auth.js v5 ([src/lib/auth/oidc.ts](src/lib/auth/oidc.ts)) drives the IdP redirect; the cache verifies via OIDC `ServerVerify` hook.  | Generic OIDC provider (Keycloak, Auth0, Entra, Okta — anything with `/.well-known/openid-configuration`). Single IdP across all clusters; per-cluster federation is v2.    |
| UI session     | iron-session v8, 8-hour TTL, `httpOnly` + `SameSite=Strict` + `Secure` (in production).                                              | Cookie is signed + encrypted with `IRON_SESSION_SECRET`.                                                                                                                   |
| Auth.js cookie | Separate JWT-strategy cookie holding the IdP-issued access token until the post-callback handler seals it into iron-session.         | Signed with `AUTH_SECRET`. Cleared on logout when any iron-session entry was OIDC-sourced; best-effort RP-initiated logout when the IdP advertises `end_session_endpoint`. |
| CSRF           | Origin-header check on mutating verbs in the proxy.                                                                                  | All mutating routes 403 on `Origin` mismatch.                                                                                                                              |

## Project layout

```text
src/
├── app/                              # Next.js App Router
│   ├── (app)/                        # Authenticated routes
│   │   ├── topology/                 # Phase A — members / ring / heartbeat (live SSE since C)
│   │   ├── keys/                     # Phase B1 — Single-Key Inspector
│   │   ├── metrics/                  # Phase B2 — sparklines dashboard
│   │   ├── bulk/                     # Phase B3 — Fetch / Put / Delete tabs
│   │   ├── auth-info/                # Phase B4 — Auth posture viewer
│   │   ├── spec/                     # Phase B5 — Live API spec
│   │   └── admin/                    # Phase C — Eviction Controls (admin scope)
│   ├── (auth)/login/                 # Static-bearer paste form + OIDC sign-in button
│   └── api/
│       ├── auth/
│       │   ├── login/                # Static-bearer login + /v1/me probe
│       │   ├── logout/               # Whole-session and per-cluster logout
│       │   ├── switch-cluster/       # Active-cluster swap (C1)
│       │   ├── oidc-callback/        # Phase C — post-IdP seal into iron-session
│       │   └── [...nextauth]/        # auth.js v5 mount (CSRF, callback, signin)
│       └── clusters/[clusterId]/     # Proxy to cache (api + mgmt + control)
├── components/                       # shadcn/ui + brand / theme / data-table
├── env/                              # zod-validated process.env (incl. AUTH_OIDC_*)
├── lib/
│   ├── api/                          # proxy.ts + mgmt.ts + bulk.ts + metrics.ts
│   │                                 #   + spec.ts + spec-raw.ts + keys.ts
│   │                                 #   + generated/ (Hey API)
│   ├── auth/
│   │   ├── session.ts                # iron-session config + ClusterSession shape
│   │   ├── scopes.ts                 # scope catalog (read / write / admin)
│   │   └── oidc.ts                   # auth.js v5 NextAuth() factory + handlers
│   ├── bulk/chunk.ts                 # streaming chunk-and-aggregate helper
│   ├── clusters/                     # multi-cluster registry + YAML loader (live reload)
│   ├── csv/                          # RFC 4180 parser + serializer
│   ├── metrics/                      # ring buffer + polling hook
│   ├── topology/                     # use-topology-events SSE hook + polling fallback
│   └── query/                        # TanStack Query provider + keys + poll
└── proxy.ts                          # Next 16 edge proxy (formerly middleware)

scripts/
└── smoke-bulk.sh                     # wire-contract smoke against live cluster

tests/
└── e2e/
    ├── fixtures/
    │   ├── cache-stub.ts             # node:http stand-in for the cache
    │   ├── clusters-yaml.ts          # writes the temp clusters.yaml at module-load
    │   └── oidc-stub.ts              # node:http stand-in for the IdP (RS256 JWTs)
    ├── global-setup.ts               # boots cache + OIDC stubs
    ├── global-teardown.ts            # closes them cleanly
    ├── topology.spec.ts              # 3 scenarios + axe-core
    ├── keys.spec.ts                  # 2 scenarios — single-key round trip
    ├── metrics.spec.ts               # 2 scenarios — dashboard + a11y
    ├── bulk.spec.ts                  # 2 scenarios — round trip + a11y
    ├── auth-info.spec.ts             # 3 scenarios — identity + token-never-shown
    ├── spec.spec.ts                  # 2 scenarios — renderer + a11y
    ├── admin.spec.ts                 # 5 scenarios — Eviction Controls + a11y
    ├── multi-cluster.spec.ts         # 1 scenario  — cross-cluster switch
    └── oidc.spec.ts                  # 3 scenarios — full IdP roundtrip + logout
```

## License

[Mozilla Public License 2.0](LICENSE).

## Author

I'm a surfer, and a software architect with 15 years of experience designing
highly available distributed production systems and developing cloud-native
apps in public and private clouds. Feel free to connect with me on LinkedIn.

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/francesco-cosentino/)
