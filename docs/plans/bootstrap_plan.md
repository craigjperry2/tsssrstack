> **Historical.** This is the plan the repository was bootstrapped from. The current architecture
> is described in [ARCHITECTURE.md](../../ARCHITECTURE.md), which supersedes this plan where they
> differ.

# tsssrstack bootstrap implementation plan

## 1. Purpose and authority

Build a concrete, runnable Deno TypeScript starter application named `app` for
server-rendered hypermedia applications using Hono, Hono JSX, Datastar, and
PostgreSQL. It is a starter to clone and edit, not a generator.

`README.md` describes the architectural intent. This plan records the concrete
bootstrap decisions and takes precedence where the two conflict. Implementation
must update `README.md` so it describes only what the repository provides.

The result is successful when a developer on NixOS or nix-darwin can enter the
Nix shell, start the infrastructure, migrate the database, run the host
application, and exercise the complete reference application through Nginx.

## 2. Scope and non-goals

### In scope

- Deno 2.9, strict TypeScript, Hono, server-side Hono JSX, Datastar 1.0.2,
  PostgreSQL 17, postgres.js, Pico CSS, Nginx with Brotli, and a local LGTM
  observability stack.
- Registration, login, logout, password change, and user-owned task CRUD.
- Datastar-only task interactivity using finite Server-Sent Event responses and
  server-rendered fat morphs.
- Central authentication, authorization, CSRF, CSP, and secure-cookie controls.
- Parameterised queries stored in `.sql` files.
- Local development on NixOS and nix-darwin and verification in GitHub Actions.

### Explicit non-goals

- JavaScript-disabled task CRUD or progressive enhancement for task commands.
- Persistent SSE subscriptions, cross-tab synchronisation, server-originated
  push, broadcasters, heartbeats, replay, or background jobs.
- Node as a runtime, Node package managers, frontend build pipelines, React,
  Preact, SPA frameworks, or an ORM. Deno-compatible `npm:` imports remain
  permitted where this plan names them.
- Per-device sessions, session administration, password recovery, email
  verification, breached-password network checks, or account deletion.
- Kubernetes, production deployment, TLS termination, HTTP/2, HTTP/3, or
  container publication.
- Dynamic HTML caching or a production observability-platform installation.

## 3. Fixed runtime and dependency decisions

- Pin Deno 2.9 through `flake.lock`; use Deno as the runtime, package manager,
  formatter, linter, type checker, and test runner.
- Use exact direct dependency versions in `deno.json` and commit `deno.lock`.
  Bootstrap versions are Hono `4.12.31`, Datastar `1.0.2`, Pico CSS `2.1.1`,
  postgres.js `3.4.9`, Sqids `0.3.0`, and `@opentelemetry/api` `1.9.1`.
  Use Deno's built-in OpenTelemetry SDK/exporter rather than Node-targeted
  OpenTelemetry SDK packages. Never use dependency ranges or `latest`.
- Vendor the exact Datastar and Pico browser assets beneath
  `src/app/static/vendor/`. Record upstream URLs, versions, licenses, SHA-256
  checksums, and the Datastar release commit. Pages make no CDN requests.
- Use versioned asset names such as `datastar-1.0.2.js` and
  `pico-2.1.1.min.css`. Only versioned or content-hashed URLs receive immutable
  caching.
- Developers run the application on the host. Compose runs PostgreSQL, the
  custom Nginx image, `grafana/otel-lgtm`, and the collector that tails Nginx
  logs.
- Bind Nginx, PostgreSQL, Grafana, and OTLP published ports to `127.0.0.1`.
  The host application listens on `0.0.0.0:8000` as a documented development
  exception so the Nginx container can reach it. Nginx at
  `http://localhost:8080` is the browser entrypoint.

## 4. Application architecture

```text
Browser + Datastar
  |  GET page / POST action
  |  finite Brotli-compressed SSE response
  v
Nginx :8080 (HTTP/1.1)
  v
Hono / Deno :8000
  |- central web middleware
  |- thin route handlers
  |- Hono JSX page and #app rendering
  v
application use cases
  v
postgres.js -> parameterised .sql files -> PostgreSQL
```

The server owns authoritative state. Browser signals are untrusted input, not a
second source of truth. A task command changes state, re-queries current state,
and renders the desired UI. Datastar morphs the existing DOM toward that HTML.

Keep Hono, JSX, cookie handling, Datastar event encoding, and postgres.js out of
domain and application modules. Application use cases accept typed ports and
return domain results; web adapters translate those results to HTTP or SSE.

Expected module boundaries are:

```text
src/app/
  main.tsx
  config.ts
  domain/
  application/
    ports/
  adapters/
    persistence/
      sql/
    security/
    observability/
    web/
      middleware/
      routes/
      views/
      datastar/
  static/
migrations/
infra/
tests/
```

Individual filenames may change, but these responsibilities may not collapse
into route handlers or leak framework types into the core.

## 5. Datastar interaction contract

Datastar JavaScript is mandatory for task CRUD. Finite SSE action responses are
the application's realtime behaviour; there is no permanent subscription.

Render every authenticated application page with a stable top-level
`<div id="app">`. It contains most of the visible body, including navigation,
task forms, errors, empty states, and the task list. The document shell, vendor
script element, and static metadata remain outside it.

Use Datastar 1.0.2 syntax, including `data-signals`, `data-on:submit`,
`data-bind`, and `@post()`. Task forms are semantic accessible HTML forms but
Datastar owns submission. A representative expression is:

```html
<form data-on:submit__prevent="@post('/tasks', {contentType: 'form'})">
```

`contentType: 'form'` is mandatory so unsafe actions use
`application/x-www-form-urlencoded` and fall within Hono's CSRF middleware
coverage. Do not add a non-Datastar response mode to task commands.

Every task mutation follows exactly this sequence:

1. Authenticate and validate the form values.
2. Perform the user-scoped mutation.
3. Re-query the complete task-page view model.
4. Render the entire `#app` component through Hono JSX.
5. Return one `datastar-patch-elements` event containing that complete element.
6. Close the finite SSE response.

Business validation failures also return HTTP 200 with one complete `#app`
morph containing the submitted values and accessible error summaries. Perform
validation, database work, re-querying, and JSX rendering before opening the
stream. Unexpected failures before streaming use Hono's normal error handler.

Create one reviewed web-adapter boundary that converts the escaped Hono JSX
component to HTML and encodes it through Hono `streamSSE()`. The encoder must
correctly prefix multiline Datastar `elements` data and terminate the SSE event.
Application code must not construct HTML strings, call `raw()`, use
`dangerouslySetInnerHTML`, or use `hono/jsx/dom`.

Fat morphs are authoritative. Targeted row fragments, imperative DOM commands,
script execution, and granular server-to-client signal patches require an
explicit documented exception. User-controlled values must never be interpolated
into Datastar expressions. Keep expressions in typed JSX helpers with only
application-defined routes and operations.

## 6. Routes and navigation

Implement:

- `GET /` redirects authenticated users to `/tasks` and anonymous users to
  `/login`.
- `GET /register` and `POST /register`.
- `GET /login` and `POST /login`.
- `POST /logout`.
- `GET /profile` and `POST /profile/password`.
- `GET /tasks`.
- `POST /tasks`.
- `POST /tasks/:publicId/edit`.
- `POST /tasks/:publicId/toggle`.
- `POST /tasks/:publicId/delete`.
- `GET /healthz` and `GET /readyz`.

There is no `/tasks/sse` route.

Registration, login, logout, and a successful password change use conventional
POST/Redirect/GET because they navigate to a canonical page. This is navigation
semantics, not a JavaScript-disabled task fallback. Task command endpoints are
Datastar-only and always return `text/event-stream`.

Render semantic, accessible HTML: associated labels, validation summaries,
focusable controls, busy/disabled indicators, and useful empty states. Stable
IDs within `#app` should preserve focus and other intentional element state
during morphing.

## 7. Authentication, sessions, and authorization

### Passwords

- Accept 12-128 Unicode code points. Reject leading/trailing whitespace and a
  password containing the normalised email address. Do not impose composition
  rules.
- Use Deno 2.9 native Web Crypto Argon2id and store a PHC-formatted string with
  version 19, memory 65,536 KiB, 3 passes, parallelism 1, a random 16-byte salt,
  and a 32-byte result.
- Validate PHC structure and bounded parameters before verification.
- For an unknown login email, verify the submitted password against a fixed
  valid dummy Argon2id hash. Unknown-email and wrong-password responses must be
  indistinguishable in status, body, and application-visible logging.

### Signed stateless session

- Use Hono `getSignedCookie`, `setSignedCookie`, and `deleteCookie`. Do not build
  encrypted cookies or expose cookie operations through application ports.
- The payload contains only `userId`, `sessionVersion`, `issuedAt`, and
  `expiresAt`. It is readable but protected from modification by HMAC.
- Require a high-entropy `SESSION_SECRET` of at least 32 bytes.
- Set `HttpOnly`, `SameSite=Lax`, `Path=/`, fixed 12-hour `Max-Age` and expiry,
  and `Secure=true` in production. Local plain-HTTP development uses
  `Secure=false`. There is no sliding renewal or remember-me mode.
- On every protected request, verify the signature, payload shape, absolute
  expiry, user existence, and persisted `session_version`.
- Logout deletes the current browser cookie only. A copied cookie remains valid
  until its absolute expiry or a password change. Per-device revocation requires
  a future server-side session table and is out of scope.
- Password change verifies the current password and atomically updates the hash
  and increments `session_version`. It then issues a replacement cookie to the
  initiating browser; every prior cookie is invalid.

### Hono middleware order

Register middleware centrally in this order:

1. Request ID propagation and the outer error boundary.
2. Hono `secureHeaders()`.
3. Hono `csrf()` configured from `APP_ORIGIN`.
4. Optional signed-session parsing and user/session-version resolution.
5. Protected-route authentication guard.
6. Route handler.

Store the resolved authenticated user in a typed Hono context variable. Handlers
must not reparse the cookie. Public authentication pages may use the optional
identity; protected pages require the guard.

Apply Hono CSRF middleware to every method other than GET, HEAD, and OPTIONS.
`APP_ORIGIN` is an exact browser-visible origin such as
`http://localhost:8080`. Preserve the original `Host`, `Origin`, and
`Sec-Fetch-Site` headers through Nginx. Do not implement CSRF secrets, tokens,
double-submit cookies, hidden token inputs, or token-bearing Datastar
expressions.

Use Hono `secureHeaders()` as the sole owner of application security headers.
At minimum CSP must contain:

```text
default-src 'self';
script-src 'self' 'unsafe-eval';
style-src 'self';
img-src 'self' data:;
connect-src 'self';
object-src 'none';
base-uri 'none';
frame-ancestors 'none';
form-action 'self'
```

Also emit `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, and a restrictive
`Permissions-Policy`. Nginx must pass through rather than replace these headers.

Apply Nginx per-IP request limiting to registration and login POST routes, with
documented rate and burst values and a `429` response. Never log cookies,
passwords, session payloads, or form bodies.

## 8. Data model and public IDs

Use `bigserial` internal primary keys. Configure Sqids with a committed,
pre-shuffled ASCII alphabet and `minLength: 10`; Sqids has no salt option.
Remove `SQIDS_SALT` and do not treat the alphabet as a secret.

Sqids are URL obfuscation only. Decode at the web boundary, reject malformed or
multi-number results, and enforce ownership in SQL. Every task read, update, and
delete query filters by both internal task ID and authenticated user ID. Return
404 for malformed IDs and tasks owned by another user.

`app.users` contains `id`, `email_normalized`, `password_hash`, non-negative
`session_version`, `created_at`, and `updated_at`. Normalise email consistently
by trimming and lowercasing before validation, lookup, and storage.

`app.tasks` contains `id`, `user_id`, trimmed required `title` (maximum 200
characters), optional `description` (maximum 5,000 characters),
`is_completed`, `created_at`, and `updated_at`. The foreign key uses
`ON DELETE CASCADE`.

## 9. SQL and migrations

Store parameterised queries under `src/app/adapters/persistence/sql/` using
`$1`, `$2`, and subsequent value placeholders. Repositories call
`sql.file()` through one central path helper. Do not add a second SQL loader,
use `sql.unsafe()`, interpolate SQL strings, or accept user-controlled
identifiers. Closed application mappings are required for any dynamic ordering.

Map rows to domain objects in repositories. Transactions use postgres.js
transaction blocks. Password update plus session-version increment is one SQL
statement or one transaction.

The migration runner must:

- Create the `app` schema and `app.schema_migrations` metadata table before
  discovering pending files.
- Select files matching `NNN_description.sql` and apply them in numeric order.
- Acquire a PostgreSQL advisory lock for the complete migration run.
- Calculate and store a SHA-256 checksum for every applied file.
- Refuse to continue when an applied file's checksum has changed.
- Apply each pending file in its own transaction and record it in that same
  transaction.
- Release the lock and close the connection on success or failure.

## 10. Nginx and Brotli

Add a pinned multi-stage Nginx Dockerfile. It builds a pinned `ngx_brotli`
revision against the exact pinned Nginx source and copies only the compatible
dynamic modules into a minimal runtime image. Pin base images by digest, verify
downloaded source checksums, support amd64 and arm64, run unprivileged, and
document licenses and provenance.

Nginx proxies to `host.docker.internal:8000`; Compose adds the `host-gateway`
mapping for Linux. Local transport is HTTP/1.1. Do not claim HTTP/2 or HTTP/3
without a future TLS and production-proxy design.

Enable dynamic Brotli for `text/event-stream`, `text/html`, CSS, and JavaScript,
with gzip fallback. For finite SSE responses require:

```text
Content-Type: text/event-stream
Cache-Control: no-cache
Vary: Accept-Encoding
X-Accel-Buffering: no
```

Do not emit `no-transform`, because Nginx intentionally compresses the response.
Disable proxy buffering for SSE, set body and timeout limits, and verify the
complete event is delivered promptly. Cache only local versioned static assets
with `public, max-age=31536000, immutable`; do not cache HTML or SSE.

Emit structured JSON access/error logs with request ID, method, path, status,
duration, bytes, and user agent. Ship the log volume through OTel Collector
Contrib to LGTM.

## 11. Configuration and permissions

Implement a dependency-free typed configuration parser. Fail fast with grouped,
non-secret validation errors. Configure:

- `ENV`: `development`, `test`, or `production`.
- `APP_ORIGIN`.
- `DATABASE_URL`.
- `SESSION_SECRET`.
- `PORT` and `HOST`, defaulting to `8000` and `0.0.0.0` for local development.
- `OTEL_DENO`, `OTEL_EXPORTER_OTLP_ENDPOINT`, and
  `OTEL_EXPORTER_OTLP_PROTOCOL`, using Deno's native OTLP
  integration with `http/protobuf` for the local collector.
- `LOG_LEVEL`.

The committed `.env.example` contains development placeholders, not usable
production secrets. Sqids alphabet and minimum length are committed application
constants, not environment configuration.

Give each Deno task narrowly scoped `--allow-net`, `--allow-read`, and
`--allow-env` lists. The web task may reach only PostgreSQL and configured OTLP
destinations and read only required static/SQL paths. The migration task may
read only migrations and reach PostgreSQL. Tests receive permissions required by
their suite; do not use `-A`.

## 12. Observability

Emit structured application logs and OTLP traces/metrics. Correlate request ID,
trace ID, and span ID. Trace inbound Hono requests and database operations
without recording SQL parameter values or sensitive payloads.

Use Deno 2.9's built-in OpenTelemetry runtime integration for automatic runtime
instrumentation and OTLP export. Use only `@opentelemetry/api@1.9.1` for custom
application spans, meters, and trace correlation; do not introduce
`@opentelemetry/sdk-node` or separate JavaScript exporter packages.

Provision a starter Grafana dashboard for request rate, errors, latency, event
loop lag, and log/trace correlation. There is no active-SSE-connection metric.
Telemetry exporters are disabled in unit tests and application startup remains
available when the local LGTM endpoint is unreachable.

## 13. Tests and acceptance contracts

### Unit and integration tests

- Domain validation, email normalisation, Argon2id PHC parsing/hashing, and
  dummy-hash login behaviour.
- Signed-cookie tampering, malformed payloads, absolute expiry, missing users,
  and session-version mismatch.
- Registration, generic login failure, logout cookie deletion, password-change
  revocation, and duplicate-email handling.
- Same-origin form-encoded unsafe requests pass CSRF validation. Missing,
  cross-site, or disallowed Origin/Fetch-Metadata requests receive 403.
- Task CRUD, invalid Sqids, another user's IDs, and SQL ownership enforcement.
- Every task command returns `text/event-stream` containing exactly one
  `datastar-patch-elements` event with the complete `#app` element and a valid
  blank-line terminator. Validation errors follow the same contract.
- `/tasks/sse` returns 404 and no broadcaster, heartbeat, replay, or persistent
  connection code exists.
- Migration clean run, repeat run, concurrent-lock behaviour, rollback on
  failure, and checksum-drift refusal.
- Security headers originate from Hono and survive Nginx unchanged.

### Compression and proxy tests

Through Nginx, send a task command with `Accept-Encoding: br`, assert
`Content-Encoding: br`, decompress the body, and validate the SSE fat morph.
Repeat for gzip fallback and identity encoding. Verify `Vary`, cache headers,
disabled buffering, static immutable caching, auth rate limiting, and prompt
finite response completion.

### Architecture tests

- Domain and application modules do not import Hono, JSX, postgres.js, cookie,
  or Datastar modules.
- SQL is loaded only from `.sql` files through the approved helper.
- Application HTML is constructed only with Hono JSX; the reviewed renderer and
  event encoder are the only HTML-to-SSE boundary.
- User input cannot become raw HTML, executable URLs, or Datastar expressions.
- No persistent SSE endpoint or client subscription attribute exists.

### Performance tests

Measure non-password task-page and task-command latency under a documented Linux
CI workload. Do not impose a sub-100 ms assertion on registration, login, or
password change; Argon2id intentionally consumes time and memory. Record actual
Argon2 duration and fail only on functional errors or an explicitly documented
resource ceiling.

### Manual browser checklist

1. Register, log in, and reach the canonical `/tasks` URL.
2. Create, edit, toggle, and delete tasks without navigation.
3. Observe one complete `#app` morph per command and usable focus after morphing.
4. Trigger validation errors and verify accessible summaries and preserved input.
5. Confirm task responses are finite Brotli-compressed SSE through Nginx.
6. Change the password and confirm an older cookie is rejected.
7. Confirm all browser assets are local and Grafana correlates requests, logs,
   and traces.

## 14. CI and implementation order

Linux and macOS run `deno fmt --check`, `deno lint`, `deno check`, unit tests,
and architecture tests from `nix develop`. Ubuntu additionally builds the custom
Nginx image, starts Compose, migrates PostgreSQL, runs the host application, and
runs integration, compression, proxy, and performance tests. Always dump service
logs on failure and tear down the stack.

Implement in phases, leaving each phase passing:

1. Deno/Nix foundation, exact dependency pins, typed config, and CI skeleton.
2. PostgreSQL, custom Brotli Nginx image, Compose, and health checks.
3. Migration runner, postgres.js client, `.sql` files, and test fixtures.
4. Domain/application models, password hashing, repositories, and Sqids.
5. Hono middleware, signed sessions, authentication, CSRF, and security headers.
6. Hono JSX pages and the complete task vertical slice with Datastar fat morphs.
7. Structured telemetry, Nginx log shipping, and Grafana provisioning.
8. Hardening, complete verification, manual checklist, and README correction.

## 15. Completion criteria

- Formatting, linting, type checking, unit, integration, architecture,
  compression, proxy, and performance suites pass.
- Compose configuration and service health checks pass on Ubuntu.
- The application is usable only through Nginx at `http://localhost:8080` in the
  documented workflow.
- Registration, authentication, password change, and user isolation satisfy the
  security contracts above.
- Every task mutation returns one Brotli-compressed finite SSE fat morph of
  `#app`; no persistent SSE architecture exists.
- No SPA framework, ORM, Node runtime/toolchain, external browser asset, raw HTML
  construction, arbitrary SQL construction, or user-controlled Datastar
  expression exists.
- README accurately describes the implemented Deno/Hono/Datastar architecture
  without promising progressive enhancement, encrypted cookies, persistent SSE,
  HTTP/2, HTTP/3, or production deployment.

## 16. Primary implementation references

- Deno: <https://docs.deno.com/>
- Hono: <https://hono.dev/docs>
- Hono JSX: <https://hono.dev/docs/guides/jsx>
- Hono streaming: <https://hono.dev/docs/helpers/streaming>
- Hono cookies: <https://hono.dev/docs/helpers/cookie>
- Hono CSRF: <https://hono.dev/docs/middleware/builtin/csrf>
- Hono secure headers: <https://hono.dev/docs/middleware/builtin/secure-headers>
- Datastar backend actions: <https://data-star.dev/guide/backend_requests>
- Datastar SSE events: <https://data-star.dev/reference/sse_events>
- postgres.js: <https://github.com/porsager/postgres>
- Sqids TypeScript: <https://sqids.org/javascript>
- ngx_brotli: <https://github.com/google/ngx_brotli>
- Grafana LGTM: <https://github.com/grafana/docker-otel-lgtm>
