import type { Hono } from 'hono';
import type { TaskInput } from '../../../application/tasks.ts';
import {
  type AppContext,
  currentUser,
  form,
  page,
  requireUser,
  type WebDeps,
  type WebEnv,
} from '../context.tsx';
import { patchElements, patchSignals, sse } from '../datastar.ts';
import { taskErrors } from '../messages.ts';
import { decodePublicId } from '../public-id.ts';
import { App, ClosedEditor, TaskEditor } from '../views/tasks.tsx';

// After a successful add, reset the form's data-bind signals; a morph alone cannot clear
// what the user typed because it only reflects changed value attributes.
const clearAddForm = patchSignals({ title: '', description: '' });

const taskInput = (data: Record<string, string>): TaskInput => ({
  title: data.title ?? '',
  description: data.description ?? '',
});
const taskId = (c: AppContext) => decodePublicId(c.req.param('publicId') ?? '');

export function taskRoutes(app: Hono<WebEnv>, { tasks }: WebDeps) {
  // Fat morph of the whole #app region, always re-rendered from current server state.
  const appPatch = async (c: AppContext, values?: TaskInput, errors?: Record<string, string>) => {
    const user = currentUser(c);
    return patchElements(
      <App
        email={user.email_normalized}
        items={await tasks.list(user.id)}
        values={values}
        errors={errors}
      />,
    );
  };
  const ownedTask = (c: AppContext) => {
    const id = taskId(c);
    return id ? tasks.find(currentUser(c).id, id) : undefined;
  };

  app.get('/tasks', requireUser, async (c) => {
    const user = currentUser(c);
    return page(
      c,
      'Tasks',
      <App email={user.email_normalized} items={await tasks.list(user.id)} />,
    );
  });
  app.post('/tasks', requireUser, async (c) => {
    const input = taskInput(await form(c));
    const added = await tasks.add(currentUser(c).id, input);
    return added.ok
      ? sse(c, [await appPatch(c), clearAddForm])
      : sse(c, [await appPatch(c, input, taskErrors(added.error.problems))]);
  });
  // Editing happens in a per-task editor row (see TaskEditor). Opening, closing and failed saves
  // replace only that row; everything else fat-morphs #app and leaves open editors untouched.
  app.get('/tasks/:publicId/edit', requireUser, async (c) => {
    const task = await ownedTask(c);
    return task
      ? sse(c, [await patchElements(<TaskEditor task={task} />, 'replace')])
      : c.notFound();
  });
  app.get('/tasks/:publicId', requireUser, async (c) => {
    const task = await ownedTask(c);
    return task
      ? sse(c, [await patchElements(<ClosedEditor taskId={task.id} />, 'replace')])
      : c.notFound();
  });
  app.post('/tasks/:publicId/edit', requireUser, async (c) => {
    const task = await ownedTask(c);
    if (!task) return c.notFound();
    const input = taskInput(await form(c));
    const edited = await tasks.edit(currentUser(c).id, task.id, input);
    if (edited.ok) {
      return sse(c, [
        await appPatch(c),
        await patchElements(<ClosedEditor taskId={task.id} />, 'replace'),
      ]);
    }
    if (edited.error.kind === 'notFound') return c.notFound();
    const errors = taskErrors(edited.error.problems);
    return sse(c, [
      await patchElements(<TaskEditor task={task} values={input} errors={errors} />, 'replace'),
    ]);
  });
  for (const [path, command] of [['toggle', tasks.toggle], ['delete', tasks.remove]] as const) {
    app.post(`/tasks/:publicId/${path}`, requireUser, async (c) => {
      const id = taskId(c);
      if (!id) return c.notFound();
      const changed = await command(currentUser(c).id, id);
      return changed.ok ? sse(c, [await appPatch(c)]) : c.notFound();
    });
  }
}
