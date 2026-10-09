// The database guards the invariants on its own (docs/adr/0004). These tests connect as the
// runtime role, like the application, and check three things: every value the TypeScript domain
// accepts is stored, invalid states written around the domain are refused, and the runtime role's
// grants keep identity columns immutable.
import type { TransactionSql } from 'postgres';
import { taskRepository } from '../../src/app/adapters/persistence/task-repository.ts';
import { userRepository } from '../../src/app/adapters/persistence/user-repository.ts';
import type { Db } from '../../src/app/adapters/persistence/client.ts';
import { type EmailAddress, parseEmail } from '../../src/app/domain/identity.ts';
import { parseTaskDetails } from '../../src/app/domain/task.ts';
import { assert, assertEquals } from '../support/assert.ts';
import { dbTest, fakeArgon2Hash } from '../support/db.ts';

const checkViolation = '23514';
const insufficientPrivilege = '42501';

const details = (title: string, description = '', dueDate = '') => {
  const parsed = parseTaskDetails({ title, description, dueDate });
  if (!parsed.ok) throw new Error(`invalid test details: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
};
const email = (raw: string) => {
  const parsed = parseEmail(raw);
  if (!parsed.ok) throw new Error(`invalid test email: ${raw}`);
  return parsed.value;
};
const newOwner = async (db: Db) =>
  (await userRepository(db).create(
    email(`owner-${crypto.randomUUID()}@example.test`),
    fakeArgon2Hash('owner'),
  ))!;

// Runs one statement in a savepoint and expects PostgreSQL to refuse it with the given SQLSTATE.
// The savepoint is rolled back, so the surrounding test transaction stays usable.
async function refused(
  db: TransactionSql,
  code: string,
  label: string,
  attempt: (sql: TransactionSql) => Promise<unknown>,
) {
  try {
    await db.savepoint(attempt);
  } catch (error) {
    const actual = (error as { code?: string }).code;
    if (actual === code) return;
    throw new Error(`${label}: expected SQLSTATE ${code}, received ${actual}: ${error}`);
  }
  throw new Error(`${label}: expected SQLSTATE ${code}, but the statement succeeded`);
}

// The privilege tests prove nothing as a superuser or as the schema owner.
async function assertRuntimeRole(db: TransactionSql) {
  const [role] = await db<{ rolsuper: boolean; runtime: boolean; owner: boolean }[]>`
    SELECT rolsuper,
      pg_has_role(current_user, 'app_runtime', 'USAGE') AS runtime,
      pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = 'app.tasks'::regclass),
        'USAGE') AS owner
    FROM pg_roles WHERE rolname = current_user`;
  assert(
    role && !role.rolsuper && role.runtime && !role.owner,
    'DATABASE_URL must be a runtime login (a member of app_runtime), not the owner or a superuser',
  );
}

dbTest('the tests connect as the runtime role', async (db) => {
  await assertRuntimeRole(db);
});

dbTest('boundary values the domain accepts round-trip through the repositories', async (db) => {
  const tasks = taskRepository(db);
  const owner = await newOwner(db);
  const cases = [
    details('🙂'.repeat(200), '€'.repeat(5000), '0001-01-01'),
    details('x', 'd', '9999-12-31'),
    // Not whitespace to JavaScript's trim(), so a title may start and end with them.
    details('\u180eZero\u200bwidth\u180e'),
    details('Inner   spacing\tis kept'),
  ];
  for (const task of cases) await tasks.add(owner.id, task);
  const listed = (await tasks.listByOwner(owner.id)).reverse();
  assertEquals(
    listed.map(({ title, description, dueDate }) => ({ title, description, dueDate })),
    cases,
  );

  // An edit that moves a task to the other end of the calendar is stored too.
  assertEquals(await tasks.update(owner.id, listed[0].id, details('y', '', '9999-12-31')), true);
  assertEquals((await tasks.findByOwner(owner.id, listed[0].id))?.dueDate, '9999-12-31');
});

dbTest('every email the domain produces is stored unchanged', async (db) => {
  const users = userRepository(db);
  const id = crypto.randomUUID();
  const longest = email(
    `${'a'.repeat(320 - id.length - '@example.test'.length)}${id}@example.test`,
  );
  assertEquals(longest.length, 320);
  const addresses: EmailAddress[] = [
    longest,
    // JavaScript lowercases non-ASCII letters; PostgreSQL's lower() may not agree on them.
    email(` Zoë.İnce+${id}@Exämple.TEST `),
    email(`ΣΊΣΥΦΟΣ-${id}@example.test`),
  ];
  for (const address of addresses) {
    const account = await users.create(address, fakeArgon2Hash('h'));
    assertEquals(account?.email, address);
    assertEquals((await users.findByEmail(address))?.id, account?.id);
  }
});

dbTest('impossible due dates are refused', async (db) => {
  const owner = await newOwner(db);
  for (const dueDate of ['10000-01-01', 'infinity', '-infinity', '0001-12-31 BC']) {
    await refused(
      db,
      checkViolation,
      dueDate,
      (sql) =>
        sql`INSERT INTO app.tasks (user_id, title, due_date)
        VALUES (${owner.id}, 'Dated', ${dueDate}::text::date)`,
    );
  }
  await taskRepository(db).add(owner.id, details('Dated', '', '2026-10-09'));
  await refused(
    db,
    checkViolation,
    'update to infinity',
    (sql) => sql`UPDATE app.tasks SET due_date = 'infinity' WHERE user_id = ${owner.id}`,
  );
});

dbTest('blank, padded and overlong titles and descriptions are refused', async (db) => {
  const owner = await newOwner(db);
  const titles = [
    '',
    ' ',
    '   ',
    '\t',
    ' padded',
    'padded ',
    '\npadded',
    '\u00a0padded',
    'x'.repeat(201),
  ];
  for (const title of titles) {
    await refused(
      db,
      checkViolation,
      JSON.stringify(title),
      (sql) => sql`INSERT INTO app.tasks (user_id, title) VALUES (${owner.id}, ${title})`,
    );
  }
  for (const description of ['', 'x'.repeat(5001)]) {
    await refused(
      db,
      checkViolation,
      `description of ${description.length}`,
      (sql) =>
        sql`INSERT INTO app.tasks (user_id, title, description)
        VALUES (${owner.id}, 'Title', ${description})`,
    );
  }
});

dbTest('unnormalised or malformed emails are refused', async (db) => {
  const local = `person-${crypto.randomUUID()}`;
  const emails = [
    `${local}@Example.test`,
    ` ${local}@example.test`,
    `${local}@example.test `,
    `${local}@exa mple.test`,
    `${local}@example`,
    `${local}`,
    `${local}@@example.test`,
    `${'a'.repeat(321 - '@example.test'.length)}@example.test`,
  ];
  for (const address of emails) {
    await refused(
      db,
      checkViolation,
      JSON.stringify(address),
      (sql) =>
        sql`INSERT INTO app.users (email_normalized, password_hash)
        VALUES (${address}, ${fakeArgon2Hash('h')})`,
    );
  }
});

dbTest('a password hash that is not an Argon2id PHC string is refused', async (db) => {
  const owner = await newOwner(db);
  const hashes = [
    'correct horse battery staple',
    '',
    '$argon2i$v=19$m=65536,t=3,p=1$c2FsdA$aGFzaA',
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$aGFz+aA=',
    '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW',
  ];
  for (const hash of hashes) {
    await refused(
      db,
      checkViolation,
      JSON.stringify(hash),
      (sql) => sql`UPDATE app.users SET password_hash = ${hash} WHERE id = ${owner.id}`,
    );
  }
});

dbTest('the runtime role cannot change identity, ownership or history', async (db) => {
  await assertRuntimeRole(db);
  const owner = await newOwner(db);
  const other = await newOwner(db);
  await taskRepository(db).add(owner.id, details('Mine'));
  const attempts: [string, (sql: TransactionSql) => Promise<unknown>][] = [
    [
      'move a task to another owner',
      (sql) => sql`UPDATE app.tasks SET user_id = ${other.id} WHERE user_id = ${owner.id}`,
    ],
    [
      'change a task id',
      (sql) => sql`UPDATE app.tasks SET id = id + 1000 WHERE user_id = ${owner.id}`,
    ],
    [
      'backdate a task',
      (sql) => sql`UPDATE app.tasks SET created_at = '2000-01-01' WHERE user_id = ${owner.id}`,
    ],
    [
      'set a task updated_at',
      (sql) => sql`UPDATE app.tasks SET updated_at = '2000-01-01' WHERE user_id = ${owner.id}`,
    ],
    [
      'insert a completed task',
      (sql) =>
        sql`INSERT INTO app.tasks (user_id, title, is_completed) VALUES (${owner.id}, 'Done', true)`,
    ],
    [
      'insert a task with an id',
      (sql) =>
        sql`INSERT INTO app.tasks (id, user_id, title) VALUES (-1, ${owner.id}, 'Chosen id')`,
    ],
    [
      'set a session version',
      (sql) => sql`UPDATE app.users SET session_version = 99 WHERE id = ${owner.id}`,
    ],
    [
      'change an email',
      (sql) => sql`UPDATE app.users SET email_normalized = 'x@example.test' WHERE id = ${owner.id}`,
    ],
    ['change a user id', (sql) => sql`UPDATE app.users SET id = -1 WHERE id = ${owner.id}`],
    [
      'backdate an account',
      (sql) => sql`UPDATE app.users SET created_at = '2000-01-01' WHERE id = ${owner.id}`,
    ],
    [
      'insert a user with a session version',
      (sql) =>
        sql`INSERT INTO app.users (email_normalized, password_hash, session_version)
        VALUES ('new@example.test', ${fakeArgon2Hash('h')}, 5)`,
    ],
    ['delete an account', (sql) => sql`DELETE FROM app.users WHERE id = ${owner.id}`],
    ['read migrations', (sql) => sql`SELECT version FROM app.schema_migrations`],
    ['create a table', (sql) => sql`CREATE TABLE app.intruder (id int)`],
    ['alter a table', (sql) => sql`ALTER TABLE app.tasks ADD COLUMN intruder int`],
  ];
  for (const [label, attempt] of attempts) {
    await refused(db, insufficientPrivilege, label, attempt);
  }
});

dbTest('writing a password hash bumps the session version by exactly one', async (db) => {
  const owner = await newOwner(db);
  assertEquals(owner.sessionVersion, 0);
  // Raw SQL that does not mention session_version: the database, not the statement, revokes.
  for (const expected of [1, 2]) {
    const [row] = await db<{ session_version: number }[]>`
      UPDATE app.users SET password_hash = ${fakeArgon2Hash(`v${expected}`)}
      WHERE id = ${owner.id} RETURNING session_version`;
    assertEquals(row.session_version, expected);
  }
  assertEquals((await userRepository(db).findById(owner.id))?.sessionVersion, 2);
});

dbTest('updates maintain updated_at', async (db) => {
  const tasks = taskRepository(db);
  const owner = await newOwner(db);
  await tasks.add(owner.id, details('Touch me'));
  const [task] = await tasks.listByOwner(owner.id);

  // A change is dated by the statement that made it; nothing in these statements sets
  // updated_at. Timestamps are compared in SQL, at full microsecond precision.
  type Stamped = { stamped: boolean; after_creation: boolean }[];
  const edited = await db<Stamped>`UPDATE app.tasks SET title = 'Touched' WHERE id = ${task.id}
    RETURNING updated_at = statement_timestamp() AS stamped, updated_at > created_at AS after_creation`;
  const toggled = await db<Stamped>`UPDATE app.tasks SET is_completed = true WHERE id = ${task.id}
    RETURNING updated_at = statement_timestamp() AS stamped, updated_at > created_at AS after_creation`;
  const passwordChanged = await db<Stamped>`
    UPDATE app.users SET password_hash = ${fakeArgon2Hash('next')} WHERE id = ${owner.id}
    RETURNING updated_at = statement_timestamp() AS stamped, updated_at > created_at AS after_creation`;
  const expected = { stamped: true, after_creation: true };
  assertEquals([edited[0], toggled[0], passwordChanged[0]], [expected, expected, expected]);
});
