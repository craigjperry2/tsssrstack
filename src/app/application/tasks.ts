import { err, ok, type Result } from '../domain/shared.ts';
import { parseTaskDetails, type TaskProblems } from '../domain/task.ts';
import type { TaskRepository } from './ports/task-repository.ts';

// Task use cases for a signed-in owner. Inputs are raw strings from any driving adapter; the
// domain decides whether they are valid.
export type TaskInput = Readonly<{ title: string; description: string }>;
export type Invalid = Readonly<{ kind: 'invalid'; problems: TaskProblems }>;
export type NotFound = Readonly<{ kind: 'notFound' }>;
const notFound: NotFound = { kind: 'notFound' };

export function taskService({ tasks }: Readonly<{ tasks: TaskRepository }>) {
  return {
    list: (ownerId: number) => tasks.listByOwner(ownerId),
    find: (ownerId: number, taskId: number) => tasks.findByOwner(ownerId, taskId),

    async add(ownerId: number, input: TaskInput): Promise<Result<void, Invalid>> {
      const details = parseTaskDetails(input);
      if (!details.ok) return err({ kind: 'invalid', problems: details.error });
      await tasks.add(ownerId, details.value);
      return ok(undefined);
    },

    async edit(
      ownerId: number,
      taskId: number,
      input: TaskInput,
    ): Promise<Result<void, Invalid | NotFound>> {
      const details = parseTaskDetails(input);
      if (!details.ok) return err({ kind: 'invalid', problems: details.error });
      return await tasks.update(ownerId, taskId, details.value) ? ok(undefined) : err(notFound);
    },

    async toggle(ownerId: number, taskId: number): Promise<Result<void, NotFound>> {
      return await tasks.toggleCompleted(ownerId, taskId) ? ok(undefined) : err(notFound);
    },

    async remove(ownerId: number, taskId: number): Promise<Result<void, NotFound>> {
      return await tasks.remove(ownerId, taskId) ? ok(undefined) : err(notFound);
    },
  };
}
export type TaskService = ReturnType<typeof taskService>;
