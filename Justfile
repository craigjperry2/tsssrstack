set shell := ["bash", "-uc"]

# List the supported developer and agent commands.
default:
    @just --list --unsorted

# Create .env when missing and install the exact locked dependency set.
[group('run')]
setup:
    node tools/dev.ts setup

# Set up, migrate this worktree's database, start its dev server on its own port, wait until ready.
[group('run')]
up:
    node tools/dev.ts up

# Stop this worktree's dev server; its database is kept.
[group('run')]
down:
    node tools/dev.ts down

# Stop and start this worktree's dev server.
[group('run')]
restart:
    node tools/dev.ts restart

# Show this worktree's server, port, database and PostgreSQL; exits 1 unless healthy: just status [--json].
[group('run')]
[positional-arguments]
status *args:
    node tools/dev.ts status "$@"

# Print this worktree's application URL, port and database: just urls [--json].
[group('run')]
[positional-arguments]
urls *args:
    node tools/dev.ts urls "$@"

# Read this worktree's dev server log: just logs [--follow] [--tail N].
[group('run')]
[positional-arguments]
logs *args:
    node tools/dev.ts logs "$@"

# Print status, the non-secret environment and the recent dev server log.
[group('run')]
diagnose:
    node tools/dev.ts diagnose

# Run any command with this worktree's port and database: just exec [--set KEY=VALUE] -- <command>.
[group('run')]
[positional-arguments]
exec *args:
    node tools/dev.ts exec "$@"

# Create this worktree's database when missing and apply pending migrations.
[group('database')]
db-migrate:
    node tools/dev.ts db-migrate

# Create the next numbered migration file from a description; write it before migrating.
[group('database')]
db-revision message:
    node tools/dev.ts db-revision {{ quote(message) }}

# Drop and recreate only this worktree's database; run once without a token to see it.
[group('database')]
db-reset confirm="":
    node tools/dev.ts db-reset {{ quote(confirm) }}

# Fast edit loop: lint, then the tests that need no database.
[group('test')]
test-fast: lint test-unit

# Run the tests that need no database (the database tests report as skipped).
[group('test')]
test-unit:
    env -u DATABASE_URL pnpm test

# Run every test against this worktree's migrated database: just test [node --test options].
[group('test')]
[positional-arguments]
test *args:
    node tools/dev.ts test "$@"

# Boot the NixOS module in VMs and test the deployed stack end to end (x86_64 Linux with KVM).
[group('test')]
test-e2e:
    nix build .#checks.x86_64-linux.nixos-module -L --no-link

# Run CI's checks without changing source files: format, lint, types, vendor sums, all tests, audit.
[group('quality')]
check: fmt-check lint typecheck vendor-verify test audit

# Apply formatting and safe lint fixes.
[group('quality')]
fix: fmt
    pnpm lint --fix

# Check formatting without changing files.
[group('quality')]
fmt-check:
    pnpm fmt:check

# Format every file in place.
[group('quality')]
fmt:
    pnpm fmt

# Lint, including the architecture rules.
[group('quality')]
lint:
    pnpm lint

# Type-check without emitting.
[group('quality')]
typecheck:
    pnpm check

# Audit the locked dependencies for known vulnerabilities.
[group('quality')]
audit:
    pnpm audit

# Verify the vendored browser assets against SHA256SUMS.
[group('quality')]
vendor-verify:
    cd src/app/static/vendor && sha256sum --check --strict SHA256SUMS

# Compile TypeScript to dist/.
[group('build')]
build:
    pnpm build

# Build the production Nix package that NixOS hosts deploy, and print its store path.
[group('build')]
release:
    nix build .#tsssrstack -L --no-link --print-out-paths

# Remove a clean, stopped worktree and its local branch after its pull request is merged.
[group('worktree')]
worktree-clean branch:
    node tools/dev.ts worktree-clean {{ quote(branch) }}
