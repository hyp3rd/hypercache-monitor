# syntax=docker/dockerfile:1

################################################################################
# Install dependencies
FROM node:25-bookworm-slim AS deps
WORKDIR /app

COPY ./package.json ./package-lock.json ./
RUN npm ci --ignore-scripts

################################################################################
# Build the Next.js standalone output
FROM node:25-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY ./ .

ENV NEXT_TELEMETRY_DISABLED=1

# Next.js basePath is baked at build time. Default "/" → no prefix.
# Set e.g. --build-arg BASE_URL=/web for OpenShift sub-path routing.
ARG BASE_URL=/
ENV BASE_URL=${BASE_URL}

RUN npm run build

################################################################################
# Runtime — distroless-style minimal image. Next.js standalone output
# (next.config.ts: `output: "standalone"`) copies only the files the
# server actually needs at runtime; we don't ship node_modules or the
# full source tree.
FROM node:25-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# server.js binds 0.0.0.0:3000 by default; pin both for clarity
# and to make logs explicit.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Run as a non-root user — standard hardening for container images
# that don't need root for any startup task. node:bookworm-slim
# already provides the `node` user; we just chown the runtime tree
# to it before switching.
RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs nextjs

# Standalone bundle layout: server.js + minimal node_modules at the
# root, .next/static for hashed assets. There's no `public/` in this
# project today (every static asset is hashed under .next/static or
# served via next/font); add a COPY here if `public/` is introduced.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# `node server.js` is what the standalone bundle's entrypoint expects.
# Don't replace with `npm start` — that re-runs `next start` which
# requires the full node_modules tree (defeating the standalone
# output's purpose).
CMD ["node", "server.js"]
