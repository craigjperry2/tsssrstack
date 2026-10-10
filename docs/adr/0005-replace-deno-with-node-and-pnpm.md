# 0005: Replace Deno with Node and pnpm

- Status: accepted
- Date: 2026-10-10

## Context

On 2026-10-09 the Deno team announced that it is
[joining Cloudflare](https://deno.com/blog/cloudflare). The Deno runtime gets one more year of
monthly bug-fix and security releases, then its development ends. The repository chose Deno for
three things: one binary for running, formatting, linting, testing, type-checking and auditing; a
permission model scoped to individual paths, hosts and environment variables; and native
TypeScript and JSX. A runtime without security fixes is not an option for a project whose goal is
strong systemic protections, so we have to move.

The candidates were Node with pnpm, and Bun. We care most about simplicity, few moving parts and
security.

## Decision

**Node runs the application and pnpm manages its dependencies.** Both come from the Nix dev shell,
pinned by `flake.lock`, like PostgreSQL. The rest of the toolchain is pinned in `package.json`:

| Concern            | Deno            | Now                                                           |
| ------------------ | --------------- | ------------------------------------------------------------- |
| Run, sandbox       | `deno run`      | `node --permission` running `dist/` (see below)               |
| TypeScript and JSX | native          | `tsc` checks and compiles to `dist/`                          |
| Serve Hono         | `Deno.serve`    | `@hono/node-server`, Hono's own adapter                       |
| Test               | `deno test`     | `node:test`                                                   |
| Format, lint       | `deno fmt/lint` | oxfmt, oxlint; the architecture plugin is an oxlint JS plugin |
| Dependencies       | `deno.json`     | pnpm, `pnpm-lock.yaml`; Hono moves from JSR to npm            |
| Audit              | `deno audit`    | `pnpm audit`                                                  |

Bun was rejected because it has no permission model at all, and because it lacks the WebCrypto
Argon2id the password adapter uses (it offers a Bun-only API instead). Node computes the same
Argon2id output as Deno, so stored hashes still verify.

**pnpm's supply-chain settings** live in `pnpm-workspace.yaml`: only versions at least seven days
old install (matching the Dependabot cooldown), a drop in a package's publishing trust fails the
install, transitive dependencies cannot come from git or tarball URLs, and dependency build scripts
never run.

**Node's permission model** replaces Deno's flags. It is coarser:

| Deno                                  | Node                                                    |
| ------------------------------------- | ------------------------------------------------------- |
| `--allow-read=` static and SQL paths  | the same, plus `dist/` and `node_modules/` (code loads) |
| `--allow-net=127.0.0.1,localhost,...` | `--allow-net`, all or nothing                           |
| `--allow-env=ENV,APP_ORIGIN,...`      | nothing: Node cannot restrict environment access        |
| no write, subprocess, FFI, workers    | the same by default under `--permission`                |

To compensate for the environment, the architecture lint allows `process` only in `config.ts`
and the migration runner. That guards against accidental use in our code, not against a malicious
dependency. Three narrower exceptions exist: `pnpm dev` adds `--allow-child-process`, because
`node --watch` restarts the app in a child process; and `pnpm test` reads the whole repository and
allows native addons, because the test runner needs the working directory and oxlint's rule tester
is a native module. `pnpm start` and `pnpm migrate` have neither.

The migration happened in two pull requests: the first made the code runtime-neutral while Deno's
CI still guarded it, the second switched the runtime and toolchain.

## Consequences

- The toolchain is several tools instead of one. Each is pinned and updated by Dependabot, and the
  scripts in `package.json` are the single entry point.
- Code runs from `dist/`, so there is a build step, and `pnpm dev` runs `tsc --watch` beside
  `node --watch`. Files read at runtime (SQL, static assets, migrations) are addressed from the
  repository root, the working directory, not relative to the module.
- The sandbox is weaker for network and environment access, as above.
- WebCrypto Argon2id is still experimental in Node and logs a warning. If its API changes,
  `node:crypto`'s `argon2` is the fallback, with the same parameters.
- oxlint's JS plugin API is in alpha. Its API matches ESLint's, so ESLint can run the same plugin
  if we ever need to switch.
- OpenTelemetry, which Deno provided built in and which was off by default, is gone. Adding it back
  means the OpenTelemetry SDK packages, which deserve their own decision.
