# Application Tech Stack Guide

## Goal

Build a server-first web application with strong systemic protections.

## Stack

- **Runtime:** Deno
- **Language:** TypeScript, strict mode
- **HTTP / routing / middleware:** Hono
- **Server-side HTML:** Hono JSX
- **Browser interactivity:** Datastar
- **Realtime updates:** Server-Sent Events via Datastar
- **Database:** PostgreSQL
- **Database driver:** postgres.js
- **SQL:** parameterised queries stored in `.sql` files
- **Package management:** Deno
- **Formatting / linting / testing:** built-in Deno tooling

Do not introduce Node, pnpm, Vite, React, Preact, an ORM, or a client-side SPA framework unless a concrete requirement justifies them.

---

## Architectural Model

The application is a **server-rendered hypermedia application**, not a frontend/backend split.

```text
Browser
  │
  │ HTML / POST / SSE
  ▼
Datastar
  │
  ▼
Hono
  ├─ routing
  ├─ middleware
  ├─ authentication / CSRF enforcement
  └─ JSX rendering
       │
       ▼
Application / domain
       │
       ▼
postgres.js
       │
       ▼
parameterised .sql files
       │
       ▼
PostgreSQL
```

The server owns authoritative application state.

The server renders HTML representing the desired UI state.

Datastar morphs the existing DOM toward that state.

Prefer re-rendering a meaningful region of the page over manually encoding many fine-grained DOM mutations.

---

## Deno

Use Deno as the runtime and toolchain.

Prefer:

```bash
deno run
deno task
deno fmt
deno lint
deno test
deno check
deno add
```

Do not add separate tooling for functionality already provided by Deno.

Use restricted runtime permissions. Grant only required:

- network destinations
- environment variables
- filesystem paths
- subprocess access

Do not default to unrestricted permissions.

---

## Hono

Use Hono for:

- routing
- middleware
- HTTP request/response handling
- central security enforcement
- server-side JSX rendering

Do not build a custom HTTP framework on top of `Deno.serve()`.

Keep handlers thin:

```text
HTTP
→ validate/authenticate
→ application operation
→ database
→ render HTML
```

---

## Hono JSX

Use Hono JSX as the **only normal HTML construction mechanism**.

Example:

```tsx
function UserCard({ user }: { user: User }) {
  return (
    <article>
      <h2>{user.name}</h2>
      <p>{user.biography}</p>
    </article>
  );
}
```

Dynamic values must flow through JSX so they are escaped by default.

Prohibit application use of:

```text
dangerouslySetInnerHTML
raw()
manually constructed HTML strings
```

If trusted raw HTML is genuinely required, isolate it behind one reviewed sanitisation boundary.

Do not use `hono/jsx/dom`.

Hono JSX is a server-side rendering mechanism in this architecture. Datastar owns browser-side interaction.

---

## Datastar

Use Datastar for:

- declarative browser interaction
- server-triggered UI updates
- SSE
- DOM morphing
- limited transient client-side state

Do not introduce a second client-side state-management architecture.

Prefer:

```text
server changes state
→ server queries current state
→ server renders HTML
→ Datastar morphs DOM
```

over:

```text
server returns imperative UI commands
→ client manually updates individual elements
```

Fat morphs are acceptable. Prefer architectural simplicity over manually maintaining many small fragments when the larger rendered region is inexpensive.

Treat Datastar expressions as **code**, never as user-controlled data.

User input must never be inserted into a Datastar expression.

Where practical, wrap Datastar attributes behind typed helpers/components rather than constructing arbitrary expression strings throughout the application.

---

## CSP and Datastar

Datastar currently requires CSP support for dynamic expression evaluation, typically including:

```text
script-src 'self' 'unsafe-eval'
```

Treat this as an explicit architectural trade-off.

`unsafe-eval` does not disable CSP entirely, but it removes an important defence against converting attacker-controlled strings into executable JavaScript.

Maintain a restrictive CSP around it, including appropriate values for:

```text
default-src
script-src
style-src
img-src
connect-src
object-src
base-uri
frame-ancestors
form-action
```

Because `unsafe-eval` is required, preserving the following invariant is especially important:

> Untrusted data may become rendered text or safe attribute values, but must never become HTML structure or executable Datastar expressions.

---

## Database Access

Use PostgreSQL directly.

Do not introduce an ORM by default.

Keep queries in `.sql` files.

Example:

```sql
-- sql/users/get_by_id.sql

SELECT
    id,
    name,
    email
FROM app_user
WHERE id = $1;
```

Call them with postgres.js parameters:

```ts
const rows = await sql.file<User[]>(
  queryPath("users/get_by_id.sql"),
  [userId],
);
```

Never build SQL using user-controlled string interpolation.

Bad:

```ts
`SELECT * FROM app_user WHERE id = '${id}'`
```

Good:

```sql
WHERE id = $1
```

with:

```ts
[id]
```

Parameters are for **values**, not SQL identifiers.

For dynamic table names, column names, or sort expressions, use closed application-defined mappings rather than accepting arbitrary strings.

Example:

```ts
type UserSort = "name" | "createdAt";
```

Map those values explicitly to trusted SQL fragments.

---

## SQL Injection Rule

Application code must not dynamically construct arbitrary SQL.

Prefer a narrow database API consisting of:

```text
.sql file
+
parameter values
```

If dynamic SQL is unavoidable, isolate it and review it explicitly.

Where possible, enforce this rule through linting or architecture checks.

---

## CSRF

Cookie-authenticated state-changing requests require systemic CSRF protection.

Apply protection centrally in middleware, before application handlers.

For state-changing methods such as:

```text
POST
PUT
PATCH
DELETE
```

enforce an appropriate combination of:

- secure session cookies
- `SameSite`
- Origin validation
- CSRF tokens where required

Do not rely on individual handlers remembering to enable CSRF protection.

---

## XSS

Primary defence:

```text
untrusted value
→ Hono JSX
→ escaped HTML
```

Do not construct HTML by concatenating strings.

Do not allow user-controlled values to become:

- raw HTML
- script contents
- Datastar expressions
- executable URLs
- event handler code

Treat raw HTML rendering as a privileged operation.

---

## Project Shape

```text
src/
  main.ts
  domain/
  application/
  web/
    routes/
    components/
    pages/
  db/

sql/
  users/
  orders/

static/
  datastar.js

migrations/

deno.json
deno.lock
```

---

## Dependency Policy

Expected application dependencies:

```text
Hono
Datastar
postgres.js
```

Everything else must justify itself.

Before adding a dependency, ask:

1. Does the platform already provide this?
2. Does this dependency remove a meaningful correctness or security risk?
3. Does it replace substantial custom infrastructure?
4. Will it become part of the application's conceptual architecture?

Avoid dependencies added only for convenience around trivial code.

---

## Change Workflow

`main` is protected by the `main` ruleset (source of truth: `.github/rulesets/main.json`):

- no direct pushes, force pushes, or branch deletion
- every change lands through a pull request
- the CI checks `deno (ubuntu-latest)` and `deno (macos-latest)` must pass before merging

Work on a branch, push it, and open a pull request against `main`. Never push to `main` directly
or try to bypass the ruleset.

Before pushing, run the same checks CI runs (`.github/workflows/ci.yml`):

```bash
deno fmt --check
deno lint
deno check src/app/main.tsx
deno task test   # set DATABASE_URL to a migrated database to include the repository tests
deno audit
(cd src/app/static/vendor && sha256sum --check --strict SHA256SUMS)
```

If you rename the CI workflow job or change its matrix, update the required status checks in
`.github/rulesets/main.json` and the live ruleset in the same change. Otherwise every pull request
waits forever for a check that no longer exists.

---

## Operating Principles

Prefer:

- server-owned state
- HTML over JSON APIs for UI interactions
- declarative desired state over imperative DOM manipulation
- parameterised SQL over query construction
- safe-by-default APIs
- central security controls
- explicit domain types
- boring code
- fewer architectural concepts
- dependencies that eliminate sharp edges

Avoid:

- SPA architecture
- duplicated client/server state
- frontend build pipelines without necessity
- ORMs without demonstrated benefit
- arbitrary HTML strings
- arbitrary SQL construction
- arbitrary Datastar expressions
- security controls that depend on developer memory

The desired result is a system where the easiest way to write application code is also the safe and architecturally correct way.
