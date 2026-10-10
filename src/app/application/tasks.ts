import { utcDateOf } from '../domain/calendar.ts';
import { err, ok, type Result } from '../domain/shared.ts';
import { isOverdue, parseTaskDetails, type Task, type TaskProblems } from '../domain/task.ts';
import type { Clock } from './ports/clock.ts';
import type { TaskRepository } from './ports/task-repository.ts';

// Task use cases for a signed-in owner. Inputs are raw strings from any driving adapter; the
// domain decides whether they are valid.
export type TaskInput = Readonly<{ title: string; description: string; dueDate: string }>;
// A task as listed, with its derived state as of today.
export type ListedTask = Task & Readonly<{ overdue: boolean }>;
export type Invalid = Readonly<{ kind: 'invalid'; problems: TaskProblems }>;
export type NotFound = Readonly<{ kind: 'notFound' }>;
const notFound: NotFound = { kind: 'notFound' };

export function taskService({ tasks, clock }: Readonly<{ tasks: TaskRepository; clock: Clock }>) {
  return {
    // "Today" is read once, so every task in one list is judged against the same date.
    async list(ownerId: number): Promise<ListedTask[]> {
      const today = utcDateOf(clock.now());
      return (await tasks.listByOwner(ownerId)).map((task) => ({
        ...task,
        overdue: isOverdue(task, today),
      }));
    },
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
      return (await tasks.update(ownerId, taskId, details.value)) ? ok(undefined) : err(notFound);
    },

    async toggle(ownerId: number, taskId: number): Promise<Result<void, NotFound>> {
      return (await tasks.toggleCompleted(ownerId, taskId)) ? ok(undefined) : err(notFound);
    },

    async remove(ownerId: number, taskId: number): Promise<Result<void, NotFound>> {
      return (await tasks.remove(ownerId, taskId)) ? ok(undefined) : err(notFound);
    },
  };
}
export type TaskService = ReturnType<typeof taskService>;
