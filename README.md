# tsssrstack

`tsssrstack` is a runnable Deno starter for server-rendered Hono JSX and Datastar applications. It
is deliberately server-first: PostgreSQL holds the authoritative state, Hono renders HTML, and
Datastar applies complete `#app` morphs returned in finite SSE responses for task commands.

## Included reference application

- Account registration, login/logout, password change, signed stateless sessions, central CSRF
  protection, CSP, and user-scoped task CRUD.
- PostgreSQL migrations and parameterised `.sql` files used through postgres.js.
- Bulma CSS (npm, served by the app) and vendored Datastar assets; the browser makes no CDN
  requests.
- Nginx reverse proxy at `http://localhost:8080`, with proxy buffering disabled for finite SSE
  responses. The Deno host process listens on port 8000 only so the local Nginx container can reach
  it.

## Run locally

1. Copy `.env.example` to `.env` and set a real development `SESSION_SECRET`.
2. Load that environment in your shell, then run `nix develop`.
3. Start PostgreSQL and Nginx with `docker compose up -d`. On first start, the PostgreSQL container
   runs `infra/postgres/dev-roles.sql`, which creates the development runtime login `app_web`. For a
   database created some other way, run that file once with `psql`; it is idempotent.
4. Run `deno task migrate`, then `deno task dev`. Migrations connect as the schema owner
   (`MIGRATION_DATABASE_URL`); the app connects as `app_web` (`DATABASE_URL`), which can only do
   what the `app_runtime` role is granted.
5. Visit [http://localhost:8080](http://localhost:8080), rather than port 8000.

When `ENV=development`, the server seeds a convenience account on startup, `dev@example.com` /
`devdevdevdev`, unless that email already exists. The seed never runs in test or production
environments and never overwrites an existing account's password.

The Nix shell supplies Deno, Docker tooling, and PostgreSQL client utilities on NixOS and
nix-darwin. `deno task check`, `deno fmt --check`, `deno lint`, and `deno task test` are the normal
verification commands. Set `DATABASE_URL` to the runtime login on a migrated database to include the
repository and schema tests; without it they are reported as ignored.

## Architecture

The code follows ports and adapters around a small domain core: `domain/` and `application/` are
plain TypeScript, and the web, persistence and security adapters plug into ports defined by the
application. A `deno lint` plugin enforces the dependency rule. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the map, the vocabulary and how to add a feature, and
[`docs/adr/`](docs/adr) for the decisions behind it.

Task commands are Datastar form-encoded POSTs answered by one finite SSE response. By default that
response is a single `datastar-patch-elements` event re-rendering the whole escaped `#app` region.
Two exceptions are deliberate: editor rows are replaced on their own so open editors survive other
actions, and a successful add also patches signals to clear the form. There is no persistent SSE
endpoint, broadcaster, SPA, ORM, Node runtime, or CDN asset dependency.

Passwords are Argon2id PHC strings using Deno Web Crypto. Session cookies are signed, HTTP-only,
SameSite Lax, and fixed to twelve hours; changing a password increments the persisted session
version and invalidates older cookies.

PostgreSQL guards the invariants the TypeScript domain explains: column domains refuse invalid
emails, titles, descriptions, dates and non-Argon2id hashes; triggers maintain `updated_at` and bump
the session version on every password change; and column-level grants make owners, ids and history
immutable for the app. In production, create your own login role and `GRANT app_runtime TO` it. See
[ADR 0004](docs/adr/0004-postgresql-guards-the-invariants.md).
