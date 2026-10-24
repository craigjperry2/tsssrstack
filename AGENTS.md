# Repository guidance for coding agents

tsssrstack is a server-first web application: Hono renders HTML with JSX, Datastar morphs the page,
and PostgreSQL holds the authoritative state. The `Justfile` is the single entry point for every
development task, and `just --list` is the authoritative command inventory. Recipes call the
`package.json` scripts or `tools/dev.ts`, which keeps each worktree's ports, database, state and
processes separate. Do not reconstruct commands from `package.json`, CI or the README.

## Start here

- Work in an isolated Git worktree on a feature branch named for the task in short kebab-case
  (`<short-task>`, the repository's convention; `deps/` and `dependabot/` belong to automation).
  Never develop on `main`. From the primary checkout:
  `git fetch origin && git worktree add --no-track -b <short-task> ../<checkout>-<short-task> origin/main`.
- Enter the pinned toolchain (Node, pnpm, PostgreSQL, `just`) with `nix develop`. From outside it,
  run any recipe as `nix develop --command just <recipe>`. In an Amp orb the login shell loads the
  dev shell only inside the primary checkout, so use that form in other worktrees.
- `just setup` creates `.env` when missing (copied from the primary checkout, otherwise from
  `.env.example` with a random `SESSION_SECRET`) and installs the exact locked dependencies.
- `just up` is the clean-worktree entry point. It runs `setup`, creates and migrates this
  worktree's database, starts the dev server (`pnpm dev`, which rebuilds and restarts on change)
  in the background on this worktree's port, waits for `/readyz`, and prints the URLs.
- Each worktree is isolated: the primary checkout uses port 8000 and the database named in `.env`
  (`app`); every other worktree gets a port derived from its path (with a fallback when busy) and
  its own database, `app_<hash>`, in the shared local PostgreSQL. Set `TSSSRSTACK_PORT` to choose
  the port. State lives in the gitignored `.run/` directory.
- Use `just status`, `just urls`, `just logs` and `just diagnose` before reproducing any startup
  step by hand. `just down` stops the server and keeps the database; `just restart` does both.
- PostgreSQL itself is shared and not managed per worktree. When `just up` reports it unavailable:
  in an Amp orb run `sudo systemctl start tsssrstack-postgres`; elsewhere run
  `process-compose up -D postgres` in the primary checkout.

## Architecture and safety boundaries

[ARCHITECTURE.md](ARCHITECTURE.md) is the canonical map of directories, layers and ports, and
`docs/adr/` records the decisions behind them. Read both before changing structure.

### Stack

- **Runtime:** Node (current LTS, from the Nix dev shell)
- **Language:** TypeScript, strict mode
- **HTTP / routing / middleware:** Hono
- **Server-side HTML:** Hono JSX
- **Browser interactivity:** Datastar
- **Realtime updates:** Server-Sent Events via Datastar
- **Database:** PostgreSQL
- **Database driver:** postgres.js
- **SQL:** parameterised queries stored in `.sql` files
- **Package management:** pnpm
- **Type checking / build:** `tsc`
- **Formatting / linting:** oxfmt / oxlint
- **Testing:** `node:test`
- **Task runner:** `just`

Do not introduce Vite, a bundler, React, Preact, an ORM, or a client-side SPA framework unless a
concrete requirement justifies them. Deno is being retired (ADR 0005); do not reintroduce it.

### Architectural model

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

The server owns authoritative application state and renders HTML representing the desired UI
state. Datastar morphs the existing DOM toward that state. Prefer re-rendering a meaningful region
of the page over manually encoding many fine-grained DOM mutations.

### Project shape

The code follows ports and adapters:

```text
src/app/main.tsx, config.ts   composition root (nothing imports it)
src/app/domain/               entities, value objects, rules: pure TypeScript
src/app/application/          use cases; ports/ holds the interfaces adapters implement
src/app/adapters/<name>/      web (Hono, JSX, Datastar), persistence (postgres.js, sql/), security
```

Dependencies point inwards only: domain → domain; application → application, domain; an adapter
→ itself, application, domain and packages. Adapters never import each other. The domain and
application layers use no JSX, `process`, `fetch`, `Date.now()`/`new Date()` or `Math.random()`;
inject those through a port. `just lint` enforces this with `tools/architecture_lint.ts`.

When adding a feature, work inwards-out: domain, application (and port), persistence, web,
then wiring in `main.tsx`. Update ARCHITECTURE.md when the structure or vocabulary changes, and
add an ADR for a decision a future reader would question.

### Node and pnpm

Node runs the application; pnpm manages dependencies. `tsc` type-checks and compiles the
TypeScript and JSX to `dist/`, which Node runs. Run tasks through `just`; add dependencies with
`pnpm add --save-exact <package>`. Use `pnpm dlx` for one-off package binaries, never `npx`.

Prefer Node built-ins (`node:test`, `node:fs`, Web Crypto, `fetch`) over packages, and do not add
tooling that duplicates what these tools already do.

Run the application with Node's permission model (`--permission`). Grant only what is required:

- filesystem read paths, one `--allow-fs-read` flag per path
- network access (`--allow-net` is all or nothing)
- no writes, subprocesses, workers or native addons unless a concrete requirement needs them

`tools/dev.ts` is development tooling, not application code: it uses the Node standard library
only and runs without the permission model because it manages files and processes.

Node cannot restrict environment variables, so only `src/app/config.ts` and the migration runner
may use `process` in the application; the architecture lint enforces this.

Keep pnpm's supply-chain settings in `pnpm-workspace.yaml` (release age, trust policy, no
dependency build scripts). Do not loosen them to get a dependency installed.

### Hono and Hono JSX

Use Hono for routing, middleware, HTTP handling, central security enforcement and server-side JSX
rendering. Do not build a custom HTTP framework on top of `node:http`; serve Hono with
`@hono/node-server`. Keep handlers thin:

```text
HTTP
→ validate/authenticate
→ application operation
→ database
→ render HTML
```

Use Hono JSX as the **only normal HTML construction mechanism**. Dynamic values must flow through
JSX so they are escaped by default. Prohibit application use of `dangerouslySetInnerHTML`, `raw()`
and manually constructed HTML strings. If trusted raw HTML is genuinely required, isolate it behind
one reviewed sanitisation boundary. Do not use `hono/jsx/dom`: Hono JSX renders on the server and
Datastar owns browser-side interaction.

### Datastar

Use Datastar for declarative browser interaction, server-triggered UI updates, SSE, DOM morphing
and limited transient client-side state. Do not introduce a second client-side state-management
architecture. Prefer:

```text
server changes state
→ server queries current state
→ server renders HTML
→ Datastar morphs DOM
```

over the server returning imperative UI commands for the client to apply element by element. Fat
morphs are acceptable when the larger rendered region is inexpensive.

Treat Datastar expressions as **code**, never as user-controlled data. User input must never be
inserted into a Datastar expression. Wrap Datastar attributes behind typed helpers/components
rather than constructing arbitrary expression strings throughout the application.

### CSP and Datastar

Datastar requires `script-src 'self' 'unsafe-eval'` for dynamic expression evaluation. Treat this
as an explicit trade-off: `unsafe-eval` removes an important defence against converting
attacker-controlled strings into executable JavaScript. Maintain a restrictive CSP around it,
including `default-src`, `script-src`, `style-src`, `img-src`, `connect-src`, `object-src`,
`base-uri`, `frame-ancestors` and `form-action`, and preserve this invariant:

> Untrusted data may become rendered text or safe attribute values, but must never become HTML
> structure or executable Datastar expressions.

### Database access and SQL injection

Use PostgreSQL directly; do not introduce an ORM. Keep queries in `.sql` files and call them with
postgres.js parameters:

```ts
const rows = await sql.file<User[]>(queryPath('users/get_by_id.sql'), [userId]);
```

Never build SQL with user-controlled string interpolation. Parameters are for **values**, not
identifiers: for dynamic table names, column names or sort expressions, map a closed
application-defined type (such as `type UserSort = 'name' | 'createdAt'`) to trusted SQL
fragments. If dynamic SQL is unavoidable, isolate it and review it explicitly.

PostgreSQL guards the invariants; the TypeScript domain explains them (ADR 0004). Each domain
value type needs a matching database domain or constraint that accepts everything the TypeScript
accepts (never stricter, so a valid value never becomes a 500). Each new table states its
`app_runtime` grants in its migration. The app connects with `DATABASE_URL` as a member of
`app_runtime`; only migrations use the owner's `MIGRATION_DATABASE_URL`.

Migrations are ordered, checksummed SQL files in `migrations/`. Create one with
`just db-revision "description"`, write it (the template refuses to apply until its guard
statement is removed), then run `just db-migrate`. Never edit an applied migration; on this
worktree's database, `just db-reset` re-applies everything from scratch.

### CSRF and XSS

Cookie-authenticated state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) are protected
centrally in middleware, before application handlers, with secure session cookies, `SameSite`,
Origin validation and CSRF tokens where required. Do not rely on individual handlers remembering
to enable CSRF protection.

The primary XSS defence is untrusted value → Hono JSX → escaped HTML. Do not allow user-controlled
values to become raw HTML, script contents, Datastar expressions, executable URLs or event handler
code. Treat raw HTML rendering as a privileged operation.

### Local data and destructive commands

- `just db-reset` drops and recreates only this worktree's database. It refuses to run until you
  pass the exact token it prints (`reset-<database>`). In the primary checkout that database is
  the shared development database `app`.
- `tools/dev.ts` creates, drops and grants only on a loopback PostgreSQL server and refuses any
  other host. Never point `.env` at shared or production data.
- `just down`, `just restart` and `just db-reset` stop only processes this worktree started,
  verified by PID and start time. If a command reports a foreign PID, investigate; do not kill it.
- `.env` holds development-only credentials (including the `app_web` and `app` passwords). Never
  commit it.

### Dependency policy

Expected application dependencies are Hono (served by `@hono/node-server`), Datastar and
postgres.js. Everything else must justify itself. Before adding a dependency, ask:

1. Does the platform already provide this?
2. Does this dependency remove a meaningful correctness or security risk?
3. Does it replace substantial custom infrastructure?
4. Will it become part of the application's conceptual architecture?

Avoid dependencies added only for convenience around trivial code.

## Tests and quality

- `just test-fast` is the normal edit loop: lint, then every test that needs no database.
- `just test-unit` runs only the tests that need no database; the repository and schema tests
  report as skipped.
- `just test` migrates this worktree's database and runs the whole suite against it. Extra
  arguments are `node --test` options, e.g. `just test --test-name-pattern="footer"`.
- `just test-e2e` boots the NixOS module in VMs and checks the deployed stack end to end. It needs
  x86_64 Linux with KVM (orbs have none) and CI does not run it; run it when changing
  `infra/nixos/` and report it as not run when you cannot.
- `just check` is the non-mutating gate and runs what CI runs: `fmt-check`, `lint`, `typecheck`,
  `vendor-verify`, `test` and `audit`. Each also exists as its own recipe.
- `just fix` formats every file and applies safe lint fixes. `just fmt` formats only.
- `just build` compiles to `dist/`. `just release` builds the production Nix package that NixOS
  hosts deploy, as CI does; run it when `pnpm-lock.yaml` or `infra/nixos/` changes (a stale
  `pnpmDeps` hash fails there).
- Add or update tests with behaviour changes. Do not weaken assertions or skip safety checks to
  make a failure pass.

## Debugging

- `just urls` prints the application URL; browse it directly (Nginx is not part of the
  per-worktree stack). `APP_ORIGIN` is set to exactly that origin, so use `127.0.0.1`, not
  `localhost`, or CSRF checks reject form posts. In development the server seeds
  `dev@example.com` / `devdevdevdev`.
- `just status` exits 0 only when this worktree's server is running and `/readyz` answers;
  `just status --json` and `just urls --json` are machine-readable.
- `just logs` shows the dev server log; add `--follow` or `--tail N`. `just diagnose` prints
  status, the non-secret environment and the recent log.
- `just exec -- <command>` runs any command with this worktree's `PORT`, `APP_ORIGIN`,
  `DATABASE_URL` and `MIGRATION_DATABASE_URL`, without a shell, so wrap commands that read those
  variables: `just exec -- sh -c 'psql "$DATABASE_URL"'`. Add `--set KEY=VALUE` before `--` to
  override a variable.
- Errors from `tools/dev.ts` go to stderr prefixed `[tsssrstack] ERROR:` with a non-zero exit;
  startup failures include the server log.
- In an Amp orb, `.amp/services.yaml` serves the primary checkout's app through a portal for
  humans (`amp orb services ensure`); agents testing their own worktree use `just up`.

## Commits, pull requests and cleanup

`main` is protected by the `main` ruleset (source of truth: `.github/rulesets/main.json`): no
direct pushes, force pushes or branch deletion; every change lands through a pull request; and
the CI checks `node (ubuntu-latest)` and `node (macos-latest)` must pass before merging. Never
push to `main` or try to bypass the ruleset.

- Inspect `git status` and `git diff` before staging. Stage only intended files, inspect
  `git diff --cached`, and keep commits focused.
- Use Conventional Commit subjects such as `feat(scope): add behaviour`,
  `fix(scope): correct failure`, `test(scope): cover edge case` or
  `chore(tooling): improve workflow`, with imperative, concise summaries.
- Before pushing, run `git diff --check` and `just check`, plus `just release` or `just test-e2e`
  when the change calls for them. Report anything not run.
- Verify `gh auth status`, push the feature branch normally (`git push -u origin <short-task>`),
  and open a draft pull request with `gh pr create --draft --fill`. Include verification notes
  and any migration or operational notes. Inspect CI with `gh pr checks`.
- If you rename the CI workflow job or change its matrix, update the required status checks in
  `.github/rulesets/main.json` and the live ruleset in the same change. Otherwise every pull
  request waits forever for a check that no longer exists.
- Never run `gh pr merge`; merging is a human task. Never force-push, hard-reset, force-clean, or
  forcibly delete branches or worktrees, and never delete remote branches.
- After a human merges the pull request, run `just down` in the feature worktree, then from
  another checkout run `just worktree-clean <short-task>`. It verifies the pull request is merged
  and the worktree is clean and stopped before removing the worktree and local branch. It never
  deletes the remote branch, and it leaves the worktree's database in the local cluster.

## Operating principles

Prefer server-owned state, HTML over JSON APIs for UI interactions, declarative desired state
over imperative DOM manipulation, parameterised SQL over query construction, safe-by-default APIs,
central security controls, explicit domain types, boring code, fewer architectural concepts, and
dependencies that eliminate sharp edges.

Avoid SPA architecture, duplicated client/server state, frontend build pipelines without
necessity, ORMs without demonstrated benefit, arbitrary HTML strings, arbitrary SQL construction,
arbitrary Datastar expressions, and security controls that depend on developer memory.

The desired result is a system where the easiest way to write application code is also the safe
and architecturally correct way.
