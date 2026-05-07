include .project-settings.env

# HyperCache Monitor — Makefile is the quality-gate contract.
#
# AGENTS.md §4: every target listed here must be wired and
# green before declaring a task done. `make ci` runs the full
# gate sequence (fmt-check + lint + typecheck + test + sec +
# build) and is what CI invokes.
#
# Why a Makefile over a single npm script: stable target names
# across repos (the cache repo uses the same vocabulary), and
# operators expect `make ci` from muscle memory.

REPO_PREFIX ?= github.com/hyp3rd/hypercache-monitor
NODE_VERSION ?= 25

NPM ?= npm
NPX ?= npx

# All targets are PHONY — none of them produce a tracked
# artefact. Splitting them out at the bottom keeps the rule
# bodies readable.

# ---- Help ------------------------------------------------------------
help: ## Print available targets and their descriptions.
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# ---- Development -----------------------------------------------------
# `make build` requires no env stubs: src/env/server.ts skips
# strict validation during NEXT_PHASE=phase-production-build,
# which Next sets for us. Runtime (operator deploy) still
# enforces validation on each fresh server process — the build
# artifact is JS source, not a snapshot of module exports.

dev: ## Run the dev server (next dev) on :3000.
	$(NPM) run dev

build: ## Production build (next build, standalone output).
	$(NPM) run build

start: ## Run the production server (requires a prior `make build`).
	$(NPM) run start

# ---- Quality gates ---------------------------------------------------
fmt: ## Auto-format with Prettier.
	$(NPX) prettier --write .

fmt-check: ## Verify Prettier formatting (CI-friendly; non-zero on diff).
	$(NPX) prettier --ignore-unknown --check .

lint: ## Run ESLint flat config.
	$(NPM) run lint

lint-fix: ## ESLint with --fix.
	$(NPM) run lint:fix

typecheck: ## TypeScript type-check (no emit).
	$(NPX) tsc --noEmit

test: ## Vitest unit + component tests.
	$(NPX) vitest run

test-watch: ## Vitest in watch mode (interactive).
	$(NPX) vitest

e2e: ## Playwright end-to-end suite.
	$(NPX) playwright test

# `npm audit` exit codes: 1 on findings >= --audit-level threshold.
# Two transitive moderate postcss vulns ship with Next 16; the
# fix would downgrade Next to v9 (breaking). We accept moderate
# findings until Vercel patches and gate CI on `high+` only.
sec: ## npm audit for high+ severity findings.
	$(NPM) audit --audit-level=high

# ---- Codegen ---------------------------------------------------------
codegen: ## Regenerate the OpenAPI typed client from a running cache cluster.
	$(NPM) run codegen

# CI gate: regenerate + assert no diff. Surfaces drift between
# the committed generated code and the live spec the cache
# binary serves.
codegen-check: ## Regenerate + fail if the output diff is non-empty.
	$(NPM) run codegen
	@git diff --exit-code src/lib/api/generated/ \
		|| (echo "codegen drift detected; commit the regenerated client"; exit 1)

# ---- Composite -------------------------------------------------------
# Order matters: format-check first (instant), lint next
# (fastest of the slow checks), build last (longest). Each
# step fails fast on its own — no point running `build` if
# typecheck already errored.
ci: fmt-check lint typecheck test sec build ## Run every quality gate.

# ---- Local cluster (cross-repo) -------------------------------------
# Brings up the cache cluster expected to be at the sibling
# `../hypercache` checkout. If the path is wrong, the call
# fails loudly — better than silently pointing at a stale
# binary.
start-dev-scaled: ## Boot a local 5-node hypercache cluster (sibling repo).
	@if [ ! -f ../hypercache/docker-compose.cluster.yml ]; then \
		echo "expected ../hypercache/docker-compose.cluster.yml; clone the cache repo as a sibling"; \
		exit 1; \
	fi
	cd ../hypercache && docker compose -f docker-compose.cluster.yml up -d

stop-dev-scaled: ## Tear down the local cluster.
	@if [ ! -f ../hypercache/docker-compose.cluster.yml ]; then exit 0; fi
	cd ../hypercache && docker compose -f docker-compose.cluster.yml down

# ---- Smoke tests (live cluster) -------------------------------------
# Wire-contract checks that hit a real cache server's client API,
# bypassing the Next.js proxy. Run after `make start-dev-scaled`
# or against any reachable cluster via HYPERCACHE_API_URL +
# HYPERCACHE_TOKEN env. Not part of `make ci` — these need an
# external dependency the unit/E2E gates don't.
smoke-bulk: ## Smoke-test the batch endpoints against a live cluster.
	./scripts/smoke-bulk.sh

.PHONY: help dev build start fmt fmt-check lint lint-fix typecheck \
	test test-watch e2e sec codegen codegen-check ci \
	start-dev-scaled stop-dev-scaled smoke-bulk
