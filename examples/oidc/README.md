# HyperCache OIDC example

End-to-end working example of the **Phase C OIDC sign-in flow**, ready
to run with one command:

```bash
make start-oidc          # from the monitor repo root
```

You get a 5-node HyperCache cluster, a pre-seeded Keycloak IdP, and
the Monitor — all wired together so an operator can sign in via the
IdP and exercise every UI surface against a real distributed cache.

## What ships

| Service           | Image / source                                          | Host port                | Role                                                                                                                                        |
| ----------------- | ------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `keycloak`        | `quay.io/keycloak/keycloak:26.1`                        | `8080`                   | IdP. Realm + client + 3 test users imported from `keycloak/realm.json` at boot.                                                             |
| `hypercache-1..5` | Built from `../../../hypercache/cmd/hypercache-server/` | `8081–8085`, `9081–9085` | 5-node cache cluster (defined inline in this overlay's compose). Each node runs the Phase C OIDC verifier alongside the static-bearer flow. |
| `monitor`         | Built from this repo's `Dockerfile`                     | `3000`                   | Monitor with both static-bearer paste form **and** "Sign in with Keycloak" button on `/login`.                                              |

## Prerequisites

- Docker Desktop 4.x or Docker Engine 24+ with Compose v2 (`docker compose` subcommand).
- The cache repo cloned as a sibling of the monitor:

  ```text
  ~/Developer/github.com/hyp3rd/
  ├── hypercache/                 # cache repo
  └── hypercache-monitor/         # this repo
  ```

- One `/etc/hosts` entry — see below.

### `/etc/hosts` entry (one-time)

The Monitor's auth.js redirects the browser to Keycloak using the
issuer URL `http://keycloak:8080`. The cache containers reach the
same URL via Docker's internal DNS (the `keycloak` service on the
shared network). For both sides to agree on the host string, your
host machine needs a single line in `/etc/hosts`:

```text
127.0.0.1   keycloak
```

That's the entire setup. Without it the browser would 404 on the
redirect — and you'd see auth.js's `?error=Configuration` page after
clicking the OIDC button. The cache verifier compares the JWT's
`iss` claim against `HYPERCACHE_OIDC_ISSUER` exactly, so we can't
bypass this with a `localhost` redirect — both sides have to use
`keycloak`.

## Run it

```bash
# From the monitor repo root:
make start-oidc          # brings up the full stack
make oidc-logs           # tails Keycloak + monitor logs
make stop-oidc           # tears it down (preserves volumes)
make clean-oidc          # tears it down + drops volumes
```

First boot takes ~3 minutes (5 cache nodes + Keycloak realm import +
monitor build). Subsequent boots are sub-30s thanks to the build cache.

Once it's up:

1. Open <http://localhost:3000/login>
1. Click **Sign in with Keycloak (dev)**
1. Sign in as one of the three pre-seeded users:

   | Username | Password | Scopes               | What you can do                                  |
   | -------- | -------- | -------------------- | ------------------------------------------------ |
   | `admin`  | `admin`  | read + write + admin | Everything, including `/admin` Eviction Controls |
   | `ops`    | `ops`    | read + write         | Read + write keys, no eviction control           |
   | `viewer` | `viewer` | read                 | Topology, key reads, metrics                     |

1. You land on `/topology` with a live SSE feed from the cluster.

The static-bearer paste form is still rendered on `/login` —
hybrid coexistence. Paste the cluster's static token (`dev-token`,
matches `HYPERCACHE_AUTH_TOKEN` in the cache compose) to log in
without hitting the IdP. Same UI, same proxy code path, different
identity source.

## How the pieces fit

```text
   Browser
     │
     │ 1. operator clicks "Sign in with Keycloak"
     ▼
   ┌─────────────────────┐                       ┌──────────────────┐
   │ monitor (next.js)   │   2. signin POST      │  keycloak (IdP)  │
   │ auth.js v5 mount    │──────────────────────▶│  realm: hypercache│
   │                     │   3. browser redirect │                  │
   │                     │◀──────────────────────│                  │
   └─────────────────────┘                       └──────────────────┘
     │                                                ▲
     │ 4. /api/auth/oidc-callback (post-IdP seal)     │
     │                                                │ 5. cache verifies
     │ 6. /v1/me probe with IdP-issued JWT            │    JWT signature +
     ▼                                                │    aud + iss via
   ┌─────────────────────────────────────────────┐    │    JWKS fetch
   │  hypercache cluster (5 nodes)               │────┘
   │  HYPERCACHE_OIDC_ISSUER=http://keycloak:...│
   │  HYPERCACHE_OIDC_AUDIENCE=hypercache-monitor│
   │  HYPERCACHE_OIDC_SCOPE_CLAIM=cache_scopes  │
   └─────────────────────────────────────────────┘
```

The IdP-issued access token rides through the Monitor's iron-session
cookie (sealed with `source: "oidc"`) and then through the proxy
into the cache's `Authorization: Bearer …` header. The cache's
resolve chain (`pkg/httpauth/policy.go:resolve`) tries the static
token table first; on no match, it falls through to the OIDC
verifier configured by `HYPERCACHE_OIDC_*`. Identity + scopes from
the JWT drive the per-route gates the same way they do for static
tokens.

## Customizing

The example is intentionally self-contained so the boot path is
deterministic. To experiment:

- **Add another user** — edit `keycloak/realm.json` (the `users`
  array), then `make clean-oidc && make start-oidc` (the realm is
  imported once on first boot).
- **Switch to a real IdP** — drop the `keycloak` service, point
  `AUTH_OIDC_ISSUER` + `HYPERCACHE_OIDC_ISSUER` at your provider, and
  match the audience claim. The cache + monitor wiring is unchanged.
- **Change the scope claim shape** — Keycloak's role-to-scope mapper
  in `realm.json` writes a `cache_scopes` array; the cache reads it
  via `HYPERCACHE_OIDC_SCOPE_CLAIM=cache_scopes`. To use the
  standard OAuth2 `scope` string claim instead, set
  `multivalued: "false"` on the mapper and unset
  `HYPERCACHE_OIDC_SCOPE_CLAIM` (the cache defaults to `scope`).

## Security notes (read before pointing this at production)

- The realm secret (`hypercache-monitor-dev-secret`), the
  iron-session secret, and the auth.js secret are all checked into
  this directory for one-command reproducibility. **None of them are
  production-grade.** Rotate everything before deploying anything
  derived from this example.
- Keycloak runs in `start-dev` mode (in-memory H2 database, no TLS,
  no admin throttling). Production needs `start --optimized` plus a
  real database, TLS termination, and `KC_PROXY=edge`.
- The cache's static-bearer fallback (`HYPERCACHE_AUTH_TOKEN=dev-token`)
  is enabled deliberately so you can compare the two flows side-by-
  side. Production deployments using OIDC exclusively should unset
  `HYPERCACHE_AUTH_TOKEN` (and remove the env line from the cache
  compose) so a leaked dev token can't be replayed against a real
  cluster.
