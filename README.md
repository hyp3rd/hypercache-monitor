# HyperCache Monitor

Operator control panel for [HyperCache](https://github.com/hyp3rd/hypercache)
distributed cache clusters. Read-only Topology surface today; Single-Key
Inspector, Metrics, and Bulk Operations land in Phase B.

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
- **Recharts** via shadcn/ui charts (Phase B)
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

| Variable                              | Required | Description                                                                                                                       |
| ------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `HYPERCACHE_API_URL`                  | yes      | Client API base URL (e.g. `http://cache:8080`).                                                                                   |
| `HYPERCACHE_MGMT_URL`                 | yes      | Management HTTP base URL (e.g. `http://cache:8081`).                                                                              |
| `IRON_SESSION_SECRET`                 | yes      | Cookie sealing key, ≥ 32 chars. Generate with `openssl rand -base64 48`.                                                          |
| `IRON_SESSION_COOKIE_NAME`            | no       | Defaults to `hcm_session`. Override only for multi-instance hosts.                                                                |
| `BASE_URL`                            | no       | Next.js `basePath` (e.g. `/web` for OpenShift sub-path routing). Defaults to `/`.                                                 |
| `HYPERCACHE_MONITOR_ENABLE_ADMIN_OPS` | no       | When `"true"` AND session has `admin` scope, enables the eviction control proxy. Off by default — see "Admin-scope gating" below. |

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
| `make test`      | Vitest unit + component tests (28 tests).                   |
| `make e2e`       | Playwright + axe-core (3 scenarios).                        |
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

| Phase | Surfaces                                                                          | Status  |
| ----- | --------------------------------------------------------------------------------- | ------- |
| **A** | Bootstrap + auth shell + **Topology** (members / ring / heartbeat)                | shipped |
| **B** | Single-Key Inspector / Metrics / Bulk Ops / Auth Posture / Spec viewer            | next    |
| **C** | Multi-cluster registry / SSE for live topology / Eviction Controls / auth.js OIDC | future  |

The Phase C "SSE for live topology" item is blocked on the cache repo growing
a `GET /cluster/events` endpoint. Tracked there.

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
│   │   └── topology/                 # Phase A's surface
│   ├── (auth)/login/                 # Bearer-token sign-in
│   └── api/clusters/[clusterId]/     # Proxy to cache (api + mgmt + control)
├── components/                       # shadcn/ui + custom (brand, theme, etc.)
├── env/                              # zod-validated process.env
├── lib/
│   ├── api/                          # proxy.ts + mgmt.ts wrapper + generated/
│   ├── auth/session.ts               # iron-session config
│   ├── clusters/                     # cluster registry (single in A, multi in C)
│   └── query/                        # TanStack Query provider + keys + poll
└── proxy.ts                          # Next 16 edge proxy (formerly middleware)

tests/
└── e2e/
    ├── fixtures/cache-stub.ts        # node:http stand-in for the cache
    ├── global-setup.ts               # boots the stub
    └── topology.spec.ts              # 3 scenarios + axe-core
```

## License

[Mozilla Public License 2.0](LICENSE).

## Author

I'm a surfer, and a software architect with 15 years of experience designing
highly available distributed production systems and developing cloud-native
apps in public and private clouds. Feel free to connect with me on LinkedIn.

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/francesco-cosentino/)
