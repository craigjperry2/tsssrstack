import { users } from '../../src/app/adapters/persistence/repositories.ts';
import { taskRepository } from '../../src/app/adapters/persistence/task-repository.ts';
import type { Db } from '../../src/app/adapters/persistence/client.ts';
import { parseTaskDetails } from '../../src/app/domain/task.ts';
import { assertEquals } from '../support/assert.ts';
import { dbTest, uniqueEmail } from '../support/db.ts';

const details = (title: string, description = '') => {
  const parsed = parseTaskDetails({ title, description });
  if (!parsed.ok) throw new Error('invalid test details');
  return parsed.value;
};
const newOwner = async (db: Db) => (await users(db).create(uniqueEmail('owner'), 'hash')).id;

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
  assertEquals(listed.map((task) => [task.title, task.description, task.completed]), [
    ['Second', 'Notes', false],
    ['First', null, false],
  ]);
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
