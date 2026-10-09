-- PostgreSQL guards the invariants; the TypeScript domain explains them (docs/adr/0004).
--
-- The domain validates first and returns friendly, typed problems. The definitions below refuse
-- invalid states independently, whatever process writes the data. The hard rule: every check here
-- accepts everything the TypeScript domain accepts, so a TS-valid value never becomes a 500. Each
-- one rejects what the domain rejects wherever that is practical.
--
-- Whitespace below means exactly what JavaScript's String.prototype.trim() and the regex \s
-- strip: ECMAScript WhiteSpace and LineTerminator. The class is spelled out, rather than written
-- as \s or [[:space:]], so the answer never depends on the server's locale. U+180E is left out
-- because JavaScript stopped treating it as whitespace in Unicode 6.3.

-- ─── Domains: the logical types of the schema ───────────────────────────────────────────────────

CREATE DOMAIN app.email_address AS text
  CONSTRAINT email_address_shape CHECK (
    VALUE ~ '^[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff@]+@[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff@]+\.[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff@]+$'
  )
  -- Not VALUE = lower(VALUE): lower() depends on the locale and differs from JavaScript's
  -- toLowerCase() for some non-ASCII letters, so it could refuse an address the domain produced.
  CONSTRAINT email_address_lowercase CHECK (VALUE !~ '[A-Z]')
  CONSTRAINT email_address_length CHECK (char_length(VALUE) <= 320);
COMMENT ON DOMAIN app.email_address IS
  'A normalised email address (EmailAddress in domain/identity.ts): trimmed and lowercased, '
  'local@domain.tld with no whitespace and one @, at most 320 characters. One mailbox, one value.';

CREATE DOMAIN app.password_hash AS text
  CONSTRAINT password_hash_argon2id_phc CHECK (
    VALUE ~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$'
  );
COMMENT ON DOMAIN app.password_hash IS
  'An Argon2id PHC string ($argon2id$v=19$m=…,t=…,p=…$salt$hash, base64url parts). A plaintext '
  'password cannot be stored by mistake.';

CREATE DOMAIN app.task_title AS text
  CONSTRAINT task_title_length CHECK (char_length(VALUE) BETWEEN 1 AND 200)
  CONSTRAINT task_title_trimmed CHECK (
    VALUE !~ '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'
    AND VALUE !~ '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$'
  );
COMMENT ON DOMAIN app.task_title IS
  'A task title (TaskTitle in domain/task.ts): 1 to 200 characters with no leading or trailing '
  'whitespace, so it is never blank.';

CREATE DOMAIN app.task_description AS text
  CONSTRAINT task_description_length CHECK (char_length(VALUE) BETWEEN 1 AND 5000);
COMMENT ON DOMAIN app.task_description IS
  'Free text of 1 to 5000 characters (TaskDescription in domain/task.ts), kept as typed. No '
  'description is NULL, never the empty string.';

CREATE DOMAIN app.calendar_date AS date
  CONSTRAINT calendar_date_range CHECK (VALUE BETWEEN DATE '0001-01-01' AND DATE '9999-12-31');
COMMENT ON DOMAIN app.calendar_date IS
  'A calendar day written YYYY-MM-DD (CalendarDate in domain/calendar.ts): years 0001 to 9999. '
  'BC dates, five-digit years and ±infinity are refused, so the text form always sorts by date.';

-- The domains replace the table CHECKs that covered only part of each rule. Changing a column to
-- a domain over the same base type does not rewrite the table, but every existing row is checked.
ALTER TABLE app.users
  ALTER COLUMN email_normalized TYPE app.email_address,
  ALTER COLUMN password_hash TYPE app.password_hash;

ALTER TABLE app.tasks
  DROP CONSTRAINT tasks_title_check,
  DROP CONSTRAINT tasks_description_check,
  ALTER COLUMN title TYPE app.task_title,
  ALTER COLUMN description TYPE app.task_description,
  ALTER COLUMN due_date TYPE app.calendar_date;

-- ─── Triggers: rules on a single row ────────────────────────────────────────────────────────────

-- statement_timestamp(), not now(): a change is dated by the statement that made it, which also
-- differs from created_at when a row is created and changed in one transaction.
CREATE FUNCTION app.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.touch_updated_at() IS
  'Sets updated_at on every update, so no statement has to remember to.';

CREATE TRIGGER users_touch_updated_at BEFORE UPDATE ON app.users
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER tasks_touch_updated_at BEFORE UPDATE ON app.tasks
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE FUNCTION app.revoke_sessions_on_password_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.session_version := OLD.session_version + 1;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.revoke_sessions_on_password_change() IS
  'Increments session_version whenever password_hash is written, revoking every session cookie '
  'issued before. Any value the statement tried to set is overridden.';

CREATE TRIGGER users_password_change_revokes_sessions BEFORE UPDATE OF password_hash ON app.users
  FOR EACH ROW EXECUTE FUNCTION app.revoke_sessions_on_password_change();

-- ─── Index aligned with the access path ─────────────────────────────────────────────────────────

-- sql/tasks/list.sql reads WHERE user_id = $1 ORDER BY created_at DESC, id DESC. With id in the
-- key that is a plain index-ordered scan, with no sort step. The key holds only columns that never
-- change after insert, so toggles and edits stay eligible for HOT updates. (On a large live table,
-- build the new index CONCURRENTLY, outside a migration transaction, before dropping the old one.)
DROP INDEX app.tasks_user_id_created_at_idx;
CREATE INDEX tasks_user_id_created_at_id_idx ON app.tasks (user_id, created_at DESC, id DESC);
COMMENT ON INDEX app.tasks_user_id_created_at_id_idx IS
  'Serves the owner''s task list in display order; also covers the user_id foreign key. Holds '
  'immutable columns only, keeping updates HOT-eligible.';

-- ─── The runtime interface: a least-privilege role ──────────────────────────────────────────────

-- The application connects as a login role that is a member of app_runtime (infra/postgres/
-- dev-roles.sql in development; operators create their own in production). app_runtime may read
-- accounts and tasks, register, change passwords and manage tasks: no DDL, no account deletion, no
-- migration bookkeeping. Roles are global to the cluster, so an existing role is reused; an
-- operator may create it in advance, and then the migration role needs no CREATEROLE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN;
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- created concurrently, e.g. by dev-roles.sql
END
$$;

GRANT USAGE ON SCHEMA app TO app_runtime;
GRANT USAGE ON SEQUENCE app.users_id_seq, app.tasks_id_seq TO app_runtime;

-- id, created_at, email_normalized and session_version are immutable for the application, and
-- accounts are never deleted by it. session_version and updated_at change only through triggers.
GRANT SELECT, INSERT (email_normalized, password_hash), UPDATE (password_hash)
  ON app.users TO app_runtime;

-- id, user_id (the owner) and created_at are immutable; a new task always starts not completed.
GRANT SELECT, INSERT (user_id, title, description, due_date),
  UPDATE (title, description, due_date, is_completed), DELETE
  ON app.tasks TO app_runtime;

-- app.schema_migrations is deliberately not granted.

-- ─── Meaning ────────────────────────────────────────────────────────────────────────────────────

COMMENT ON SCHEMA app IS 'tsssrstack application state. Owned by the migration role.';
COMMENT ON TABLE app.schema_migrations IS
  'Applied migrations and their SHA-256 checksums, maintained by migrate.ts. Not visible to the '
  'runtime role.';

COMMENT ON TABLE app.users IS
  'Accounts: credentials for one normalised email address. Rows are never deleted by the app.';
COMMENT ON COLUMN app.users.email_normalized IS
  'The account''s identity, as normalised by the domain. Unique, and immutable for the app.';
COMMENT ON COLUMN app.users.password_hash IS
  'Argon2id PHC string. Writing it increments session_version (trigger).';
COMMENT ON COLUMN app.users.session_version IS
  'Signed into every session cookie; a cookie with an older version is rejected. Incremented only '
  'by the password-change trigger.';
COMMENT ON COLUMN app.users.updated_at IS 'When the row last changed; maintained by a trigger.';

COMMENT ON TABLE app.tasks IS
  'Tasks, each belonging to one owner for its whole life. Overdue is derived on read from '
  'due_date and the Clock port, never stored.';
COMMENT ON COLUMN app.tasks.user_id IS
  'The owner. Immutable; every task statement is scoped by it.';
COMMENT ON COLUMN app.tasks.description IS 'NULL when there is no description.';
COMMENT ON COLUMN app.tasks.due_date IS
  'Optional calendar day with no time or zone (docs/adr/0003). Crosses the boundary as text.';
COMMENT ON COLUMN app.tasks.created_at IS 'When the task was added; orders the task list.';
COMMENT ON COLUMN app.tasks.updated_at IS 'When the row last changed; maintained by a trigger.';
