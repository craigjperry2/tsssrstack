# 0004: PostgreSQL guards the invariants; the TypeScript domain explains them

- Status: accepted
- Date: 2026-10-09

## Context

A review found that the database did not guarantee what the TypeScript domain assumes. The
`CalendarDate` value type accepts only years 0001 to 9999, but `app.tasks.due_date date` accepted BC
dates, year 10000 and `infinity`. A row due on 10000-01-01 formats as `"10000-01-01"`, which sorts
below `"2026-10-09"`, so the task showed as overdue. The title CHECK accepted whitespace-only
titles, and nothing constrained email normalisation or the password hash, although ADR 0001 claimed
the database mirrored the domain rules. The application role also owned the schema, so it could
rewrite any column, including a task's owner or an account's session version.

Brands are erased at runtime (ADR 0001). They stop mistakes in TypeScript, not in a script, a psql
session, a future second service or a bug in an adapter. We take the position of Eduardo Bellani's
[All you need is PostgreSQL](https://ebellani.github.io/blog/2026/all-you-need-is-postgresql/):
domains are the abstract data types of the logical design, business rules live in constraints and
triggers at the deepest level, and roles and grants are precise interfaces. We adopt that ethos, not
its finance-specific machinery.

## Decision

**PostgreSQL guards the invariants; the TypeScript domain explains them.** The domain validates
first and returns friendly, typed problems. The database independently refuses invalid states, as
the last line of defence, whatever process writes the data. Time-dependent policy such as overdue
stays in the domain, because it depends on the `Clock` port.

The hard rule: **every database check accepts everything the TypeScript domain accepts**, so a
TS-valid value never becomes a 500. Each check rejects what the domain rejects wherever that is
practical. Migration `003_guard_invariants.sql` implements this:

- **Domains** are the column types: `app.email_address` (no whitespace, one `@`, a dot in the domain
  part, no ASCII uppercase, at most 320 characters), `app.password_hash` (an Argon2id PHC string, so
  a plaintext password is unrepresentable), `app.task_title` (1–200 characters, no leading or
  trailing whitespace), `app.task_description` (1–5000 characters; no description is NULL) and
  `app.calendar_date` (0001-01-01 to 9999-12-31, so no BC, five-digit years or infinity). They
  replace the table CHECKs they cover.
- Where JavaScript and PostgreSQL disagree, the database is looser, never stricter. Whitespace is
  spelled out as exactly the characters JavaScript's `trim()` and `\s` treat as whitespace, so the
  result does not depend on the server's locale. Lowercase is checked as "no `[A-Z]`" rather than
  `VALUE = lower(VALUE)`, because `lower()` depends on the locale and differs from `toLowerCase()`
  for some non-ASCII letters. Lengths are counted in code points on both sides.
- **Row triggers** keep single-row rules out of the statements: a BEFORE UPDATE trigger maintains
  `updated_at` on users and tasks, and writing `password_hash` increments `session_version`, so a
  password change revokes older sessions whatever statement made it.
- **A least-privilege role is the database interface.** Migrations run as the schema owner
  (`MIGRATION_DATABASE_URL`). The application and the tests log in (`DATABASE_URL`) as a role that
  is a member of the NOLOGIN role `app_runtime`, which has only:

  | Object                         | Grant                                                                                                               |
  | ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
  | schema `app`, the id sequences | USAGE                                                                                                               |
  | `app.users`                    | SELECT; INSERT (email_normalized, password_hash); UPDATE (password_hash)                                            |
  | `app.tasks`                    | SELECT; INSERT (user_id, title, description, due_date); UPDATE (title, description, due_date, is_completed); DELETE |
  | `app.schema_migrations`        | nothing                                                                                                             |

  So ids, owners, `created_at`, emails and session versions are immutable for the application, it
  cannot delete accounts, and it cannot change the schema. Every new table states its runtime grants
  in its migration; there are no default privileges.
- **COMMENT ON** documents the meaning and rule of each domain, table and non-obvious column, so
  `\d+` explains the schema.
- **Indexes follow access paths.** The task list (`user_id = $1 ORDER BY created_at DESC, id DESC`)
  is served by `(user_id, created_at DESC, id DESC)` as a pure index-ordered scan. No index contains
  a mutable column, so edits and toggles stay eligible for HOT updates.
- **Isolation stays READ COMMITTED**, deliberately. Every invariant is on a single row (domains, row
  triggers) or enforced by a unique index (email), so no read-then-write sequence can produce write
  skew. A rule that spans rows, such as a per-user task quota, is the trigger to revisit this: it
  would need SERIALIZABLE with retry (or an explicit lock), and the decision recorded here.

### Deferred, and when to adopt them

| Idea                             | Adopt when                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| System-time history tables       | Someone needs to answer "what did this look like before?" (audit, support, undo), not merely "when did it last change?"          |
| Updatable views as the interface | The table layout must change without changing the app's statements, or a second consumer needs a narrower shape than grants give |
| fillfactor tuning                | `pg_stat_user_tables` shows a low `n_tup_hot_upd / n_tup_upd` ratio on a hot table, caused by full pages                         |
| Keyset pagination                | One owner's task list is too long to render in a single response                                                                 |

## Consequences

- A TS-valid value is always stored, and an invalid state written around the domain is refused with
  a constraint or permission error. `tests/persistence/schema_test.ts` checks both as the runtime
  role, including the boundary values and the grants. Mutating a guard makes it fail.
- Each rule is written twice, once in TypeScript and once in SQL. That is the intended trade: the
  TypeScript explains (typed problem codes for the UI) and the SQL guarantees. A new domain value
  type needs a matching database domain or constraint.
- Deployments need two roles. Operators create their own login role and
  `GRANT app_runtime TO <login>`. The migration role needs CREATEROLE only if `app_runtime` does not
  exist yet.
- Migration 003 checks every existing row as it changes the column types. Rows written through the
  app pass; a database holding invalid rows refuses the migration, atomically, until they are
  repaired.
- `updated_at` is set from `statement_timestamp()`, so a change is dated by the statement that made
  it rather than by the start of its transaction.
