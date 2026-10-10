# Architecture

tsssrstack is a small task list with accounts, built to be copied. This document is the map: what
the parts are, which way dependencies point, and where new code goes. The reasons behind the larger
choices are recorded as [decisions](#decisions).

## Constraints

- **Server-first hypermedia.** PostgreSQL holds the authoritative state. The server renders HTML
  with Hono JSX, and Datastar morphs the page toward it. There is no SPA and no client-side state
  besides form signals.
- **A small, checked core.** Business rules live in plain TypeScript with no framework, database or
  I/O. They can be tested in milliseconds without a server.
- **Safe by construction.** SQL lives only in parameterised `.sql` files, HTML is built only with
  Hono JSX, and CSRF, CSP and sessions are enforced centrally.
- **PostgreSQL guards the invariants.** Domains, triggers and grants refuse invalid states whatever
  writes the data; the TypeScript domain checks first and explains the problem.
- **Few dependencies.** Hono, Datastar, postgres.js, plus Bulma and Sqids. There is no ORM, no DI
  container and no Node runtime.

## Shape

The code follows ports and adapters (hexagonal architecture). The domain and application layers form
the core. Adapters connect the core to the outside world, either driving it (HTTP) or being driven
by it (PostgreSQL, Argon2id).

```text
                ┌──────────────────────────────────────────────┐
Browser ──HTTP──▶ adapters/web          (driving adapter)       │
Datastar        │   routes · middleware · session · views       │
                │        │ calls                                │
                │        ▼                                      │
                │ ┌─ application ────────────────────────────┐  │
                │ │ taskService · identityService            │  │
                │ │ ports/  TaskRepository  UserRepository   │  │
                │ │         PasswordHasher  Clock            │  │
                │ │ ┌─ domain ─────────────────────────────┐ │  │
                │ │ │ Task · TaskTitle · isOverdue · …     │ │  │
                │ │ └──────────────────────────────────────┘ │  │
                │ └──────────────────────▲───────────────────┘  │
                │                        │ implements           │
                │ adapters/persistence  adapters/security       │──▶ PostgreSQL
                │   (driven adapters)                           │
                └──────────────────────────────────────────────┘
                   main.tsx wires adapters into services (composition root)
```

At runtime a request flows web → application → persistence. **Source dependencies all point
inwards**, though: the application defines the port interfaces, and the persistence adapter
implements them. Nothing in the core knows that Hono or PostgreSQL exist.

## Where code lives

```text
src/app/
  main.tsx                  composition root: config, adapters, system clock, services, serve()
  config.ts                 environment parsing and validation

  domain/                   entities, value objects and rules; pure TypeScript
    shared.ts               Brand, Result, codePoints
    calendar.ts             CalendarDate, utcDateOf
    task.ts                 Task, TaskTitle, TaskDescription, due dates, isOverdue
    identity.ts             EmailAddress, password policy, Account, Principal

  application/              use cases, written against ports
    tasks.ts                taskService: list, find, add, edit, toggle, remove
    identity.ts             identityService: register, logIn, changePassword, resolve
    ports/                  interfaces the core needs implemented
      task-repository.ts
      user-repository.ts
      password-hasher.ts
      clock.ts

  adapters/
    web/                    driving adapter: HTTP, HTML, SSE
      app.tsx               createWebApp: central middleware, then routes
      middleware.ts         request id, CSP and security headers
      session.ts            signed session cookie
      context.tsx           WebDeps, WebEnv, page(), form(), requireUser
      datastar.ts           the only JSX → SSE boundary, plus expression helpers
      public-id.ts          Sqids encoding of database ids for URLs
      messages.ts           domain problem codes → user-facing wording
      errors.ts             logs unexpected errors; answers a generic 500
      routes/               auth, tasks, profile
      views/                Hono JSX components
    persistence/            driven adapter: PostgreSQL
      client.ts             pool, Db type, queryPath(): the only SQL loader
      task-repository.ts    implements TaskRepository; rows → domain types
      user-repository.ts    implements UserRepository
      sql/                  one parameterised statement per file
      migrate.ts            migration runner (its own entry point)
    security/
      password.ts           implements PasswordHasher with Argon2id

  static/vendor/            vendored Datastar, checked against SHA256SUMS

migrations/                 ordered, checksummed SQL migrations: tables, domains, triggers, grants
infra/postgres/dev-roles.sql  development-only runtime login (app_web) for setup, process-compose and CI
infra/nginx/nginx.conf      development reverse proxy: SSE without buffering, login rate limits
process-compose.yaml        local PostgreSQL and Nginx, run natively from the Nix shell (ADR 0006)
tests/                      domain/, application/, persistence/, security/, web/, architecture
tools/architecture_lint.ts  oxlint plugin enforcing the dependency rule
```

## The dependency rule

| Layer            | May import                                               |
| ---------------- | -------------------------------------------------------- |
| domain           | domain                                                   |
| application      | application, domain                                      |
| adapters/`name`  | the same adapter, application, domain, external packages |
| composition root | anything; nothing imports it                             |

Adapters never import each other. For example, the web adapter does not know the persistence adapter
exists, and an adapter receives only the settings it needs, never the whole `Config`. The domain and
application layers also stay deterministic: no JSX, no `process`, `fetch`, `crypto`, `globalThis`,
`window` or `self`, no `Date` except `new Date(value)`, and no `Math.random()`. Time, randomness and
I/O have to come in through a port. A parameter or import with one of those names is fine, since
injection is the point.

This is enforced, not just documented. [`tools/architecture_lint.ts`](tools/architecture_lint.ts) is
an oxlint JS plugin. It checks every import, re-export, type-only import, `import()` type and
dynamic import under `src/app/`, and reports files outside the known layers (only `main.tsx` and
`config.ts` sit at the root). Relative paths, absolute paths and `file:` URLs are classified by the
layer they reach. `node:` built-ins and bare specifiers naming a `package.json` dependency are
external packages. Remote URLs and any other bare specifier are rejected. The purity check follows
references to the globals rather than spellings, so `globalThis.fetch`, `Date['now']` and
`const D = Date` are caught too, and it uses oxlint's scope analysis, so only a binding in an
enclosing scope excuses a name. A third rule allows `process` only in `config.ts` and
`adapters/persistence/migrate.ts`: Node cannot restrict which environment variables the process
reads, so the code is held to it instead.
[`tests/architecture_test.ts`](tests/architecture_test.ts) proves that it catches each kind of
violation. CI runs both.

## Domain model

The domain uses a few tactical DDD patterns, and only where they pay their way:

- **Value objects** are branded types with checked constructors: `TaskTitle`, `TaskDescription`,
  `CalendarDate` and `EmailAddress`. A plain `string` cannot be passed where a `TaskTitle` is
  required, so the only way to get one is through a parser that enforces the rule.
- **Entities**: `Task` and `Account` have identity and a lifecycle. A task's owner never changes.
- **Rules are pure functions over domain values.** `isOverdue(task, today)` is the clearest example.
  The domain cannot read the clock, so the application passes today in. That keeps the rule
  trivially testable on either side of midnight.
- **Expected failures are values.** Parsers and use cases return `Result` with problem codes such as
  `required`, `tooLong`, `emailInUse` and `notFound`. Problem codes are not messages: the web
  adapter decides the wording in `messages.ts`.

Identity and Tasks are two modules with their own vocabulary. They are not separate bounded
contexts: they share one database and one deployment. The only thing Tasks knows about Identity is
the owner's id.

### Vocabulary

| Term            | Meaning                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------ |
| Task            | Something an owner wants to do, with a title, an optional description and a completed flag |
| Owner           | The account a task belongs to. Every task operation is scoped to one owner                 |
| Task details    | The user-editable part of a task (title, description, due date), validated together        |
| Due date        | An optional calendar day, with no time or zone, by which the task should be done           |
| Today           | The current calendar date in UTC, read from the `Clock` port                               |
| Overdue         | Not completed, and the due date is before today. Derived on read, never stored             |
| Account         | Credentials for one normalised email address                                               |
| Principal       | The signed-in user as the rest of the app sees them: id, email, session version            |
| Session version | A counter on the account. A password change increments it, revoking older cookies          |
| Runtime role    | `app_runtime`: the app's database privileges. Owners, ids and history are read-only        |
| Migration role  | The schema owner. It runs migrations; the app never connects as it                         |

## Ports

| Port             | Implemented by                         | Why it is a port                                                |
| ---------------- | -------------------------------------- | --------------------------------------------------------------- |
| `TaskRepository` | `adapters/persistence/task-repository` | Storage. The contract includes owner scoping and atomic changes |
| `UserRepository` | `adapters/persistence/user-repository` | Storage, including the session-version bump (a trigger)         |
| `PasswordHasher` | `adapters/security/password`           | Argon2id is slow by design; use cases are tested with a fake    |
| `Clock`          | `systemClock` in `main.tsx`            | Overdue depends on today; tests fix the date                    |

These are deliberately not ports: sessions and cookies (web concerns), Sqids (URL formatting),
rendering, and readiness probes. The use cases themselves are plain functions, so they need no
inbound port interfaces.

## Persistence: the database guards the invariants

The domain validates first and returns typed problems; PostgreSQL refuses invalid states on its own,
as the last line of defence ([ADR 0004](docs/adr/0004-postgresql-guards-the-invariants.md)). Every
database check accepts everything the TypeScript domain accepts, so a TS-valid value never becomes a
500, and rejects what the domain rejects wherever that is practical. Rules that depend on time, such
as overdue, stay in the domain because they need the `Clock` port.

| Domain rule                | TypeScript (explains) | PostgreSQL (guards)                                      |
| -------------------------- | --------------------- | -------------------------------------------------------- |
| Normalised email           | `parseEmail`          | domain `app.email_address`, unique index                 |
| Passwords are only hashed  | `PasswordHasher`      | domain `app.password_hash` (Argon2id PHC shape)          |
| Title, description         | `parseTaskTitle`, …   | domains `app.task_title`, `app.task_description`         |
| Due date is a calendar day | `parseCalendarDate`   | domain `app.calendar_date` (0001-01-01 to 9999-12-31)    |
| Password change revokes    | `identityService`     | trigger: writing `password_hash` bumps `session_version` |
| `updated_at` is current    | (not modelled)        | trigger on every update                                  |
| Owner, ids, history fixed  | `Task` is readonly    | column grants: `app_runtime` cannot update them          |

**Roles.** Migrations run as the schema owner from `MIGRATION_DATABASE_URL` (`pnpm migrate`).
The app and the tests connect with `DATABASE_URL` as a login role that is a member of the NOLOGIN
role `app_runtime`. Migration 003 creates `app_runtime` if needed and grants it exactly what the
statements in `adapters/persistence/sql/` use: no DDL, no account deletion, no access to
`schema_migrations`. In development the login is `app_web`, from
[`infra/postgres/dev-roles.sql`](infra/postgres/dev-roles.sql), with a well-known password. **In
production, operators create their own login role with a real secret and run
`GRANT app_runtime TO <login>;`.** If they create `app_runtime` before the first migration, the
migration role needs no CREATEROLE.

**Isolation.** Transactions run at READ COMMITTED. Every invariant is on one row or enforced by a
unique index, so there is no read-then-write write skew. A rule spanning rows, such as a per-user
task quota, would need SERIALIZABLE plus retry.

**Indexes** follow access paths and hold only columns that never change after insert, so updates
stay HOT-eligible. `COMMENT ON` records the meaning of each domain, table and non-obvious column.

## A request, end to end

Adding a task with `POST /tasks`:

```text
browser    Datastar posts the add form, form-encoded, with the Origin header
web        middleware: request id → security headers → CSRF Origin check → session → principal
web        routes/tasks: form fields → TaskInput (raw strings)
app        taskService.add(ownerId, input)
domain       parseTaskDetails → Result<TaskDetails, TaskProblems>
app          invalid → return the problems; valid → TaskRepository.add(ownerId, details)
persist    sql/tasks/create.sql with $1 … $4; the column domains check the values again
app        taskService.list reads the Clock once and derives overdue for each task
web        render <App> with JSX from the re-queried list, send one finite SSE response:
             datastar-patch-elements (all of #app) + datastar-patch-signals (clear the form)
browser    Datastar morphs #app to match
```

## Interaction model

Commands answer with a finite SSE response, never a long-lived stream. The default is a **fat
morph**: the server re-renders the whole `#app` region from current state, and Datastar morphs the
DOM to match. This avoids hand-maintained fragments that could drift from the full render.

There are two deliberate exceptions, both in `routes/tasks.tsx`:

- **Editor rows** opt out of morphs with `data-ignore-morph`, so an open editor survives other
  actions. Opening, cancelling and failed saves replace only that row (`mode replace`).
- **A successful add** also sends `datastar-patch-signals` to clear the bound form fields, which a
  morph cannot reset.

## Security boundaries

| Concern                | Where it is enforced                                        | Tested by                                                               |
| ---------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| CSRF                   | `csrf()` Origin check in `createWebApp`, before routes      | `tests/web/app_test.ts`                                                 |
| CSP, framing, sniffing | `middleware.ts`, registered once                            | `tests/web/app_test.ts`                                                 |
| XSS                    | Hono JSX escaping; no raw HTML APIs                         | `tests/web/task_views_test.tsx`                                         |
| Datastar expressions   | built only from server URLs in `datastar.ts`                | `tests/web/task_views_test.tsx`                                         |
| SQL injection          | `.sql` files + parameters via `queryPath()`                 | code review; the core cannot import postgres.js                         |
| Task ownership         | `user_id = $n` in every statement; `user_id` is immutable   | `tests/persistence/task_repository_test.ts`, `schema_test.ts`           |
| Session revocation     | session version checked by `identityService.resolve`        | `tests/application/identity_test.ts`, `tests/web/app_test.ts`           |
| Revocation in data     | writing `password_hash` bumps `session_version` (trigger)   | `tests/persistence/schema_test.ts`                                      |
| Stored data validity   | PostgreSQL domains mirroring the value types (ADR 0004)     | `tests/persistence/schema_test.ts`                                      |
| Least privilege        | the app connects as a member of `app_runtime`               | `tests/persistence/schema_test.ts`                                      |
| Account enumeration    | one login error; dummy-hash verification for unknown emails | `tests/application/identity_test.ts`, `tests/security/password_test.ts` |

## Testing

Each layer is tested at its own boundary, with the cheapest dependencies that make the test
meaningful.

| Tests                        | Exercise                     | Use                                        |
| ---------------------------- | ---------------------------- | ------------------------------------------ |
| `tests/domain`               | value objects and rules      | nothing                                    |
| `tests/application`          | use cases                    | in-memory ports (`tests/support/fakes.ts`) |
| `tests/persistence`          | repository contracts, guards | real PostgreSQL as the runtime role        |
| `tests/security`             | the Argon2id adapter         | Web Crypto                                 |
| `tests/web`                  | HTTP, HTML and SSE behaviour | `createWebApp` with in-memory ports        |
| `tests/architecture_test.ts` | the lint plugin              | in-memory sources                          |

The persistence tests run when `DATABASE_URL` points at a migrated database (CI starts one) and are
reported as skipped otherwise. Each runs in a transaction that is rolled back. `DATABASE_URL` must
be the runtime login, as for the app, not the owner: `schema_test.ts` checks that the guards accept
every boundary value the domain accepts, refuse invalid rows written with raw SQL, and that the
runtime role cannot change owners, ids, history or the schema. Run everything with `pnpm test`.

## Adding a feature

Due dates were added this way, in a single commit. They make a compact worked example. Work from the
inside out:

1. **Domain.** Add value objects and rules to the owning module, with tests that need nothing.
2. **Application.** Extend a service, or add a port if the feature needs something new from outside
   (storage, time, email). Test it against an in-memory implementation.
3. **Persistence.** Add a migration, `.sql` files and the row mapping. Give each new value type a
   matching database domain or constraint that accepts everything the TypeScript accepts, and state
   a new table's `app_runtime` grants in its migration. Add a contract test against PostgreSQL.
4. **Web.** Add routes and views that call the service, and wording in `messages.ts`. Return a fat
   morph unless there is a reason not to.
5. **Wire** any new adapter in `main.tsx`.

`pnpm lint` reports any import that goes the wrong way.

## Decisions

Architecture decision records live in [`docs/adr/`](docs/adr):

- [0001: Ports and adapters with a small domain core](docs/adr/0001-ports-and-adapters.md)
- [0002: Server-rendered hypermedia with Datastar](docs/adr/0002-server-rendered-hypermedia-with-datastar.md)
- [0003: Due dates are calendar days, judged against today in UTC](docs/adr/0003-due-dates-use-utc-calendar-days.md)
- [0004: PostgreSQL guards the invariants; the TypeScript domain explains them](docs/adr/0004-postgresql-guards-the-invariants.md)
- [0005: Replace Deno with Node and pnpm](docs/adr/0005-replace-deno-with-node-and-pnpm.md)
- [0006: Replace Docker Compose with Nix and process-compose](docs/adr/0006-replace-docker-compose-with-nix-and-process-compose.md)

[`docs/plans/bootstrap_plan.md`](docs/plans/bootstrap_plan.md) is the plan the repository was
bootstrapped from. It is kept for history; where it differs from this document, this document wins.
