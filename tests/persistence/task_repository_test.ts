import { userRepository } from '../../src/app/adapters/persistence/user-repository.ts';
import { taskRepository } from '../../src/app/adapters/persistence/task-repository.ts';
import type { Db } from '../../src/app/adapters/persistence/client.ts';
import type { EmailAddress } from '../../src/app/domain/identity.ts';
import { parseTaskDetails } from '../../src/app/domain/task.ts';
import { assertEquals } from '../support/assert.ts';
import { dbTest, uniqueEmail } from '../support/db.ts';

const details = (title: string, description = '', dueDate = '') => {
  const parsed = parseTaskDetails({ title, description, dueDate });
  if (!parsed.ok) throw new Error('invalid test details');
  return parsed.value;
};
const newOwner = async (db: Db) =>
  (await userRepository(db).create(
    uniqueEmail('owner') as EmailAddress,
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$aGFzaA',
  ))!.id;

dbTest("task SQL never reads or changes another owner's task", async (db) => {
  const tasks = taskRepository(db);
  const owner = await newOwner(db);
  const other = await newOwner(db);
  await tasks.add(owner, details('Private'));
  const [task] = await tasks.listByOwner(owner);
  assertEquals(await tasks.listByOwner(other), []);
  assertEquals(await tasks.findByOwner(other, task.id), undefined);
  assertEquals(await tasks.update(other, task.id, details('Stolen')), false);
  assertEquals(await tasks.toggleCompleted(other, task.id), false);
  assertEquals(await tasks.remove(other, task.id), false);
  assertEquals(await tasks.findByOwner(owner, task.id), task);
});

dbTest('tasks round-trip through SQL as domain values', async (db) => {
  const tasks = taskRepository(db);
  const owner = await newOwner(db);
  await tasks.add(owner, details('First'));
  await tasks.add(owner, details('Second', 'Notes'));
  const listed = await tasks.listByOwner(owner);
  assertEquals(
    listed.map((task) => [task.title, task.description, task.dueDate, task.completed]),
    [
      ['Second', 'Notes', null, false],
      ['First', null, null, false],
    ],
  );
  const first = listed[1];
  assertEquals(first.ownerId, owner);

  assertEquals(await tasks.update(owner, first.id, details('First, edited', 'More')), true);
  assertEquals(await tasks.toggleCompleted(owner, first.id), true);
  assertEquals(await tasks.findByOwner(owner, first.id), {
    ...first,
    title: 'First, edited',
    description: 'More',
    completed: true,
  });
  assertEquals(await tasks.toggleCompleted(owner, first.id), true);
  assertEquals((await tasks.findByOwner(owner, first.id))?.completed, false);

  assertEquals(await tasks.remove(owner, first.id), true);
  assertEquals(await tasks.findByOwner(owner, first.id), undefined);
  assertEquals(await tasks.remove(owner, first.id), false);
});

dbTest('due dates round-trip as the same calendar day', async (db) => {
  const tasks = taskRepository(db);
  const owner = await newOwner(db);
  // Under a session zone far from UTC, any timestamp conversion on the way would shift the day.
  await db`SET LOCAL TIME ZONE 'Pacific/Kiritimati'`;
  await tasks.add(owner, details('Leap day', '', '2028-02-29'));
  await tasks.add(owner, details('Early', '', '0001-01-01'));
  const [early, leap] = await tasks.listByOwner(owner);
  assertEquals([leap.dueDate, early.dueDate], ['2028-02-29', '0001-01-01']);
  assertEquals((await tasks.findByOwner(owner, leap.id))?.dueDate, '2028-02-29');
  assertEquals(await tasks.update(owner, leap.id, details('Moved', '', '2030-12-31')), true);
  assertEquals((await tasks.findByOwner(owner, leap.id))?.dueDate, '2030-12-31');
  assertEquals(
    (await tasks.listByOwner(owner)).map((task) => [task.title, task.dueDate]),
    [
      ['Early', '0001-01-01'],
      ['Moved', '2030-12-31'],
    ],
  );
  assertEquals(await tasks.update(owner, leap.id, details('Undated')), true);
  assertEquals((await tasks.findByOwner(owner, leap.id))?.dueDate, null);
});
