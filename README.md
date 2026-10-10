# tsssrstack

`tsssrstack` is a runnable Node starter for server-rendered Hono JSX and Datastar applications. It
is deliberately server-first: PostgreSQL holds the authoritative state, Hono renders HTML, and
Datastar applies complete `#app` morphs returned in finite SSE responses for task commands.

## Included reference application

- Account registration, login/logout, password change, signed stateless sessions, central CSRF
  protection, CSP, and user-scoped task CRUD.
- PostgreSQL migrations and parameterised `.sql` files used through postgres.js.
- Bulma CSS (npm, served by the app) and vendored Datastar assets; the browser makes no CDN
  requests.
- Nginx reverse proxy at `http://localhost:8080`, with proxy buffering disabled for finite SSE
  responses and rate limiting on login and registration. The Node process listens on
  `127.0.0.1:8000` behind it.

## Run locally

1. Copy `.env.example` to `.env` and set a real development `SESSION_SECRET`.
2. Load that environment in your shell, then run `nix develop`.
3. From the repository root, start PostgreSQL and Nginx with `process-compose up` (add `-D` to run
   them in the background, and stop them with `process-compose down`). Both run natively from the
   Nix shell and keep their state in `.data/`; delete `.data/postgres` for a fresh database. On first
   start, `process-compose.yaml` creates the cluster and runs `infra/postgres/dev-roles.sql`, which
   creates the development runtime login `app_web`. For a database created some other way, run that
   file once with `psql`; it is idempotent.
4. Run `pnpm install`, `pnpm migrate`, then `pnpm dev`. Migrations connect as the schema owner
   (`MIGRATION_DATABASE_URL`); the app connects as `app_web` (`DATABASE_URL`), which can only do
   what the `app_runtime` role is granted.
5. Visit [http://localhost:8080](http://localhost:8080), rather than port 8000.

When `ENV=development`, the server seeds a convenience account on startup, `dev@example.com` /
`devdevdevdev`, unless that email already exists. The seed never runs in test or production
environments and never overwrites an existing account's password.

The Nix shell supplies Node, pnpm, PostgreSQL, Nginx, and process-compose on NixOS and nix-darwin;
no Docker is needed
([ADR 0006](docs/adr/0006-replace-docker-compose-with-nix-and-process-compose.md)). `pnpm check`,
`pnpm fmt:check`, `pnpm lint`, and `pnpm test` are the normal verification commands. `tsc` compiles
the TypeScript to `dist/`, which Node runs under its permission model. Set `DATABASE_URL` to the
runtime login on a migrated database to include the repository and schema tests; without it they
are reported as skipped.

## Architecture

The code follows ports and adapters around a small domain core: `domain/` and `application/` are
plain TypeScript, and the web, persistence and security adapters plug into ports defined by the
application. An oxlint plugin enforces the dependency rule. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the map, the vocabulary and how to add a feature, and
[`docs/adr/`](docs/adr) for the decisions behind it.

Task commands are Datastar form-encoded POSTs answered by one finite SSE response. By default that
response is a single `datastar-patch-elements` event re-rendering the whole escaped `#app` region.
Two exceptions are deliberate: editor rows are replaced on their own so open editors survive other
actions, and a successful add also patches signals to clear the form. There is no persistent SSE
endpoint, broadcaster, SPA, ORM, bundler, or CDN asset dependency.

Passwords are Argon2id PHC strings using Web Crypto. Session cookies are signed, HTTP-only,
SameSite Lax, and fixed to twelve hours; changing a password increments the persisted session
version and invalidates older cookies.

PostgreSQL guards the invariants the TypeScript domain explains: column domains refuse invalid
emails, titles, descriptions, dates and non-Argon2id hashes; triggers maintain `updated_at` and bump
the session version on every password change; and column-level grants make owners, ids and history
immutable for the app. In production, create your own login role and `GRANT app_runtime TO` it. See
[ADR 0004](docs/adr/0004-postgresql-guards-the-invariants.md).
