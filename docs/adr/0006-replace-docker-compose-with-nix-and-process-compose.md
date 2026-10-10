# 0006: Replace Docker Compose with Nix and process-compose

- Status: accepted
- Date: 2026-10-10

## Context

Development happens only on Nix hosts: NixOS, nix-darwin and Amp orbs, which have no Docker daemon.
The Nix dev shell, pinned by `flake.lock`, already supplied every tool, and CI and orbs already ran
PostgreSQL from it. Docker Compose survived only in the README's local workflow, where it ran
PostgreSQL and a custom Nginx image. It had drifted: Compose ran PostgreSQL 18 while CI, orbs and the
shell's own `psql` used 17. Nobody intends to deploy with Compose either.

What Compose still gave local development was one command to start and stop the services, health
checks, isolated state, and Nginx in front of the app with its SSE and rate-limiting settings.

## Decision

**The Nix shell provides PostgreSQL and Nginx, and process-compose runs them natively.**
`process-compose.yaml` at the repository root starts both: `process-compose up`, or `up -D` and
`down`. State lives in `.data/`. On first start it creates the cluster and runs
`infra/postgres/dev-roles.sql`, as the Compose entrypoint did. Every environment now uses the one
PostgreSQL that `flake.nix` pins.

process-compose comes from nixpkgs, so the flake gains no inputs. services-flake was the
alternative: it generates the same process-compose setup from Nix modules, but costs three extra
flake inputs and a layer of indirection for two services.

Nginx now listens on `127.0.0.1:8080` only, as Compose's published port did, and the app on
`127.0.0.1:8000`. process-compose's control API is unauthenticated, so the dev shell moves it from
TCP port 8080, which Nginx needs, to a Unix socket in the repository root. A local port would also
be reachable from web pages through DNS rebinding.

`infra/nginx/nginx.conf` remains the development proxy. Production deployment is a separate
decision.
