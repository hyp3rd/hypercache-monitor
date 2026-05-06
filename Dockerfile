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

# Build-time env — GATEWAY_URL is set at runtime via compose/env.
ENV NEXT_TELEMETRY_DISABLED=1

# Next.js basePath is baked at build time. Default "/" → no prefix.
# Set e.g. --build-arg BASE_URL=/web for OpenShift sub-path routing.
ARG BASE_URL=/
ENV BASE_URL=${BASE_URL}

RUN npm run build
