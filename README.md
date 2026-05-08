# HyperCache Monitor

Operator control panel for [HyperCache](https://github.com/hyp3rd/hypercache)
distributed cache clusters. **v0.6.0 · Phase B complete** — Topology,
Single-Key Inspector, Metrics, Bulk operations, Auth posture, and Live API
spec are all shipped. Phase C (multi-cluster, SSE topology, eviction controls,
OIDC) is next.

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
1. **Admin-scope gating** lives in the proxy. The cache server's mgmt port (`:8081`) doesn't
   yet enforce admin scope on `/evict` / `/clear` / `/trigger-expiration`; the proxy hard-501s
   those routes until Phase C lights them up server-side.

Every request flows: browser → Next.js edge proxy
([src/proxy.ts](src/proxy.ts)) gates the session → API route
([src/lib/api/proxy.ts](src/lib/api/proxy.ts)) attaches the bearer token from the
sealed cookie + injects an `X-Request-Id` for cross-process correlation.

## Stack

- **Next.js 16** App Router + React 19 + TypeScript strict
  (`noUncheckedIndexedAccess`, `noImplicitOverride`, `isolatedModules`)
- **shadcn/ui + Tailwind v4** (CSS-first config, no `tailwind.config.js`)
- **iron-session v8** for the auth cookie
- **TanStack Query v5** for client-side polling (2s active / 30s idle)
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

Open <http://localhost:3000>, sign in with the bearer token your cache
operator issued (matches `HYPERCACHE_AUTH_CONFIG` on the server), land on
Topology.

## Environment

Validated at boot via zod ([src/env/server.ts](src/env/server.ts)) — the
process refuses to start on any missing or malformed value.

| Variable                              | Required    | Description                                                                                                                         |
| ------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `HYPERCACHE_MONITOR_CLUSTERS`         | conditional | Path to a YAML cluster registry (see [Multi-cluster registry](#multi-cluster-registry)). When set, overrides the URL pair below.    |
| `HYPERCACHE_API_URL`                  | conditional | Single-cluster fallback: client API base URL (e.g. `http://cache:8080`). Required when `HYPERCACHE_MONITOR_CLUSTERS` is unset.      |
| `HYPERCACHE_MGMT_URL`                 | conditional | Single-cluster fallback: management HTTP base URL (e.g. `http://cache:8081`). Required when `HYPERCACHE_MONITOR_CLUSTERS` is unset. |
| `IRON_SESSION_SECRET`                 | yes         | Cookie sealing key, ≥ 32 chars. Generate with `openssl rand -base64 48`.                                                            |
| `IRON_SESSION_COOKIE_NAME`            | no          | Defaults to `hcm_session`. Override only for multi-instance hosts.                                                                  |
| `BASE_URL`                            | no          | Next.js `basePath` (e.g. `/web` for OpenShift sub-path routing). Defaults to `/`.                                                   |
| `HYPERCACHE_MONITOR_ENABLE_ADMIN_OPS` | no          | When `"true"` AND session has `admin` scope, enables the eviction control proxy. Off by default — see "Admin-scope gating" below.   |

At least one cluster source must be configured: either
`HYPERCACHE_MONITOR_CLUSTERS` (recommended) or both
`HYPERCACHE_API_URL` + `HYPERCACHE_MGMT_URL`. If both are set, the
YAML wins and the env-pair is ignored (logged at boot).

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
| `make test`      | Vitest unit + component tests (119 tests across 15 files).  |
| `make e2e`       | Playwright + axe-core (14 scenarios across 5 spec files).   |
| `make sec`       | `npm audit --audit-level=high`.                             |
| `make build`     | Production build (`next build`, standalone output).         |
| `make codegen`   | Regenerate the typed OpenAPI client from a running cluster. |

CI runs `make ci` and `make e2e` separately
([.github/workflows/](.github/workflows/)) so a flaky browser test doesn't block lint signal.

## Admin-scope gating

`POST /evict`, `POST /clear`, `POST /trigger-expiration` on the cache's
management port currently run without any auth. The UI's proxy
([src/app/api/clusters/\[clusterId\]/mgmt/control/\[op\]/route.ts](src/app/api/clusters/%5BclusterId%5D/mgmt/control/%5Bop%5D/route.ts))
hard-501s those routes by default — defense-in-depth until Phase C ships the
server-side admin-scope enforcement.

Operators who knowingly accept the risk on a non-prod cluster can flip
`HYPERCACHE_MONITOR_ENABLE_ADMIN_OPS=true`. Even then, the proxy still requires
the session to carry `admin` scope; a read-only token can't reach the upstream
mutating routes through the UI.

## Roadmap

| Phase  | Surfaces                                                                          | Status  |
| ------ | --------------------------------------------------------------------------------- | ------- |
| **A**  | Bootstrap + auth shell + **Topology** (members / ring / heartbeat)                | shipped |
| **B1** | Single-Key Inspector (`/keys`)                                                    | shipped |
| **B2** | Metrics dashboard (`/metrics`) — sparklines + ring-buffer rate math               | shipped |
| **B3** | Bulk operations (`/bulk`) — chunked CSV import + multi-key fetch + bulk delete    | shipped |
| **B4** | Auth posture viewer (`/auth-info`) — identity, scopes, OpenAPI security schemes   | shipped |
| **B5** | Live API spec viewer (`/spec`) — read-only docs renderer                          | shipped |
| **C**  | Multi-cluster registry / SSE for live topology / Eviction Controls / auth.js OIDC | future  |

The Phase C "SSE for live topology" item is blocked on the cache repo growing
a `GET /cluster/events` endpoint. Tracked there.

For wire-contract verification against a live cluster, see
[`scripts/`](scripts/) — `smoke-bulk.sh` exercises the batch endpoints end
to end. Run as `make smoke-bulk` after `make start-dev-scaled`.

## Auth posture

| What        | Where                                                                                               | Posture                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| UI ↔ cache  | Bearer token issued by the cache's `HYPERCACHE_AUTH_CONFIG` (multi-token, scoped read/write/admin). | Operator-issued out-of-band; sealed in iron-session cookie; never reaches the browser as JS-readable state. |
| UI session  | iron-session v8, 8-hour TTL, `httpOnly` + `SameSite=Strict` + `Secure` (in production).             | Cookie is signed + encrypted with `IRON_SESSION_SECRET`.                                                    |
| CSRF        | Origin-header check on mutating verbs in the proxy.                                                 | All mutating routes 403 on `Origin` mismatch.                                                               |
| Future OIDC | auth.js v5 (Phase C).                                                                               | Will route through the cache's `httpauth.Policy.ServerVerify` extension hook.                               |

## Project layout

```text
src/
├── app/                              # Next.js App Router
│   ├── (app)/                        # Authenticated routes
│   │   ├── topology/                 # Phase A — members / ring / heartbeat
│   │   ├── keys/                     # Phase B1 — Single-Key Inspector
│   │   ├── metrics/                  # Phase B2 — sparklines dashboard
│   │   ├── bulk/                     # Phase B3 — Fetch / Put / Delete tabs
│   │   ├── auth-info/                # Phase B4 — Auth posture viewer
│   │   └── spec/                     # Phase B5 — Live API spec
│   ├── (auth)/login/                 # Bearer-token sign-in
│   └── api/clusters/[clusterId]/     # Proxy to cache (api + mgmt + control)
├── components/                       # shadcn/ui + brand / theme / data-table
├── env/                              # zod-validated process.env
├── lib/
│   ├── api/                          # proxy.ts + mgmt.ts + bulk.ts + metrics.ts
│   │                                 #   + spec.ts + spec-raw.ts + keys.ts
│   │                                 #   + generated/ (Hey API)
│   ├── auth/                         # iron-session config + scope catalog
│   ├── bulk/chunk.ts                 # streaming chunk-and-aggregate helper
│   ├── clusters/                     # cluster registry (single in A, multi in C)
│   ├── csv/                          # RFC 4180 parser + serializer
│   ├── metrics/                      # ring buffer + polling hook
│   └── query/                        # TanStack Query provider + keys + poll
└── proxy.ts                          # Next 16 edge proxy (formerly middleware)

scripts/
└── smoke-bulk.sh                     # wire-contract smoke against live cluster

tests/
└── e2e/
    ├── fixtures/cache-stub.ts        # node:http stand-in for the cache
    ├── global-setup.ts               # boots the stub
    ├── topology.spec.ts              # 3 scenarios + axe-core
    ├── keys.spec.ts                  # 2 scenarios — single-key round trip
    ├── metrics.spec.ts               # 2 scenarios — dashboard + a11y
    ├── bulk.spec.ts                  # 2 scenarios — round trip + a11y
    ├── auth-info.spec.ts             # 3 scenarios — identity + token-never-shown
    └── spec.spec.ts                  # 2 scenarios — renderer + a11y
```

## License

[Mozilla Public License 2.0](LICENSE).

## Author

I'm a surfer, and a software architect with 15 years of experience designing
highly available distributed production systems and developing cloud-native
apps in public and private clouds. Feel free to connect with me on LinkedIn.

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/francesco-cosentino/)
