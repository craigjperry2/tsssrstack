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
3. Start PostgreSQL and Nginx with `docker compose up -d`.
4. Run `deno task migrate`, then `deno task dev`.
5. Visit [http://localhost:8080](http://localhost:8080), rather than port 8000.

When `ENV=development`, the server seeds a convenience account on startup, `dev@example.com` /
`devdevdevdev`, unless that email already exists. The seed never runs in test or production
environments and never overwrites an existing account's password.

The Nix shell supplies Deno, Docker tooling, and PostgreSQL client utilities on NixOS and
nix-darwin. `deno task check`, `deno fmt --check`, `deno lint`, and `deno test` are the normal
verification commands.

## Architecture and constraints

Task forms are semantic HTML, but their commands require Datastar and submit form-encoded POSTs.
Each successful command or business validation error produces exactly one `datastar-patch-elements`
event containing the entire escaped `#app` region. There is no persistent SSE endpoint, broadcaster,
SPA, ORM, Node runtime, or CDN asset dependency.

Passwords are Argon2id PHC strings using Deno Web Crypto. Session cookies are signed, HTTP-only,
SameSite Lax, and fixed to twelve hours; changing a password increments the persisted session
version and invalidates older cookies.
