import { taskService } from '../../src/app/application/tasks.ts';
import { assertEquals } from '../support/assert.ts';
import { memoryTaskRepository } from '../support/fakes.ts';

// Use cases run against the in-memory port: no HTTP, no database.
const clock = { now: () => new Date('2026-10-09T23:59:59Z') };
const owner = 1;
const other = 2;

Deno.test('invalid task input never reaches the repository', async () => {
  const tasks = taskService({ tasks: memoryTaskRepository(), clock });
  assertEquals(await tasks.add(owner, { title: ' ', description: '', dueDate: '' }), {
    ok: false,
    error: { kind: 'invalid', problems: { title: 'required' } },
  });
  assertEquals(await tasks.list(owner), []);
});

Deno.test('adding a task stores the validated values', async () => {
  const tasks = taskService({ tasks: memoryTaskRepository(), clock });
  assertEquals(
    (await tasks.add(owner, { title: '  Buy milk ', description: '', dueDate: '' })).ok,
    true,
  );
  const [task] = await tasks.list(owner);
  assertEquals([task.title, task.description, task.completed], ['Buy milk', null, false]);
});

Deno.test("commands on another owner's task report notFound and change nothing", async () => {
  const tasks = taskService({ tasks: memoryTaskRepository(), clock });
  await tasks.add(owner, { title: 'Private', description: '', dueDate: '' });
  const [{ id }] = await tasks.list(owner);
  const task = (await tasks.find(owner, id))!;
  const notFound = { ok: false, error: { kind: 'notFound' } };
  assertEquals(
    await tasks.edit(other, task.id, { title: 'Mine', description: '', dueDate: '' }),
    notFound,
  );
  assertEquals(await tasks.toggle(other, task.id), notFound);
  assertEquals(await tasks.remove(other, task.id), notFound);
  assertEquals(await tasks.find(owner, task.id), task);
});

Deno.test('listing judges every task against the UTC date of the clock', async () => {
  const tasks = taskService({ tasks: memoryTaskRepository(), clock });
  const add = (title: string, dueDate: string) =>
    tasks.add(owner, { title, description: '', dueDate });
  await add('Yesterday', '2026-10-08');
  await add('Today', '2026-10-09');
  await add('Tomorrow', '2026-10-10');
  await add('Undated', '');
  await add('Done late', '2026-10-01');
  const [doneLate] = await tasks.list(owner);
  await tasks.toggle(owner, doneLate.id);
  const listed = await tasks.list(owner);
  assertEquals(listed.map((task) => [task.title, task.overdue]), [
    ['Done late', false],
    ['Undated', false],
    ['Tomorrow', false],
    ['Today', false],
    ['Yesterday', true],
  ]);
});
