# Changelog

All notable changes to this project. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version label visible in the app's sidebar footer is the
authoritative current version.

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
