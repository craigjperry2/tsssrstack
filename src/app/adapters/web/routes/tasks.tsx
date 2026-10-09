import type { Hono } from 'hono';
import { taskInput } from '../../../domain/validation.ts';
import type { Task, User } from '../../persistence/repositories.ts';
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
import { decodePublicId } from '../public-id.ts';
import { App, ClosedEditor, TaskEditor } from '../views/tasks.tsx';

// After a successful add, reset the form's data-bind signals; a morph alone cannot clear
// what the user typed because it only reflects changed value attributes.
const clearAddForm = patchSignals({ title: '', description: '' });

export function taskRoutes(app: Hono<WebEnv>, { tasks }: WebDeps) {
  // Fat morph of the whole #app region.
  const appPatch = async (
    user: User,
    values?: { title?: string; description?: string },
    errors?: Record<string, string>,
  ) =>
    patchElements(
      <App
        email={user.email_normalized}
        items={await tasks.list(user.id)}
        values={values}
        errors={errors}
      />,
    );
  async function ownedTask(c: AppContext, user: User): Promise<Task | undefined> {
    const taskId = decodePublicId(c.req.param('publicId') ?? '');
    return taskId ? (await tasks.list(user.id)).find((task) => task.id === taskId) : undefined;
  }

  app.get('/tasks', requireUser, async (c) => {
    const user = currentUser(c);
    return page(
      c,
      'Tasks',
      <App email={user.email_normalized} items={await tasks.list(user.id)} />,
    );
  });
  app.post('/tasks', requireUser, async (c) => {
    const user = currentUser(c);
    const data = await form(c);
    const values = { title: data.title ?? '', description: data.description ?? '' };
    const errors = taskInput(values.title, values.description);
    if (Object.keys(errors).length) return sse(c, [await appPatch(user, values, errors)]);
    await tasks.create(user.id, values.title.trim(), values.description);
    return sse(c, [await appPatch(user), clearAddForm]);
  });
  // Editing happens in a per-task editor row (see TaskEditor). Opening, closing and failed saves
  // replace only that row; everything else fat-morphs #app and leaves open editors untouched.
  app.get('/tasks/:publicId/edit', requireUser, async (c) => {
    const task = await ownedTask(c, currentUser(c));
    return task
      ? sse(c, [await patchElements(<TaskEditor task={task} />, 'replace')])
      : c.notFound();
  });
  app.get('/tasks/:publicId', requireUser, async (c) => {
    const task = await ownedTask(c, currentUser(c));
    return task
      ? sse(c, [await patchElements(<ClosedEditor taskId={task.id} />, 'replace')])
      : c.notFound();
  });
  app.post('/tasks/:publicId/edit', requireUser, async (c) => {
    const user = currentUser(c);
    const task = await ownedTask(c, user);
    if (!task) return c.notFound();
    const data = await form(c);
    const values = { title: data.title ?? '', description: data.description ?? '' };
    const errors = taskInput(values.title, values.description);
    if (Object.keys(errors).length) {
      return sse(c, [
        await patchElements(<TaskEditor task={task} values={values} errors={errors} />, 'replace'),
      ]);
    }
    if (!(await tasks.edit(task.id, user.id, values.title.trim(), values.description)).length) {
      return c.notFound();
    }
    return sse(c, [
      await appPatch(user),
      await patchElements(<ClosedEditor taskId={task.id} />, 'replace'),
    ]);
  });
  for (const action of ['toggle', 'delete'] as const) {
    app.post(`/tasks/:publicId/${action}`, requireUser, async (c) => {
      const user = currentUser(c);
      const taskId = decodePublicId(c.req.param('publicId') ?? '');
      if (!taskId) return c.notFound();
      const changed = action === 'toggle'
        ? await tasks.toggle(taskId, user.id)
        : await tasks.delete(taskId, user.id);
      return changed.length ? sse(c, [await appPatch(user)]) : c.notFound();
    });
  }
}
