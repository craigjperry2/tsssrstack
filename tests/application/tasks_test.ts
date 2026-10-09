import { taskService } from '../../src/app/application/tasks.ts';
import { assertEquals } from '../support/assert.ts';
import { memoryTaskRepository } from '../support/fakes.ts';

// Use cases run against the in-memory port: no HTTP, no database.
const owner = 1;
const other = 2;

Deno.test('invalid task input never reaches the repository', async () => {
  const tasks = taskService({ tasks: memoryTaskRepository() });
  assertEquals(await tasks.add(owner, { title: ' ', description: '' }), {
    ok: false,
    error: { kind: 'invalid', problems: { title: 'required' } },
  });
  assertEquals(await tasks.list(owner), []);
});

Deno.test('adding a task stores the validated values', async () => {
  const tasks = taskService({ tasks: memoryTaskRepository() });
  assertEquals((await tasks.add(owner, { title: '  Buy milk ', description: '' })).ok, true);
  const [task] = await tasks.list(owner);
  assertEquals([task.title, task.description, task.completed], ['Buy milk', null, false]);
});

Deno.test("commands on another owner's task report notFound and change nothing", async () => {
  const tasks = taskService({ tasks: memoryTaskRepository() });
  await tasks.add(owner, { title: 'Private', description: '' });
  const [task] = await tasks.list(owner);
  const notFound = { ok: false, error: { kind: 'notFound' } };
  assertEquals(await tasks.edit(other, task.id, { title: 'Mine', description: '' }), notFound);
  assertEquals(await tasks.toggle(other, task.id), notFound);
  assertEquals(await tasks.remove(other, task.id), notFound);
  assertEquals(await tasks.find(owner, task.id), task);
});
