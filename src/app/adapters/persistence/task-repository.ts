import type { TaskRepository } from '../../application/ports/task-repository.ts';
import type { Task, TaskDescription, TaskTitle } from '../../domain/task.ts';
import { type Db, queryPath } from './client.ts';

// Row shapes stay private to the adapter; the rest of the system sees domain types.
type TaskRow = {
  id: number;
  user_id: number;
  title: string;
  description: string | null;
  is_completed: boolean;
};

// Stored values were validated on the way in, and the table's CHECK constraints mirror the
// domain rules, so rows are trusted to satisfy the value types.
const toTask = (row: TaskRow): Task => ({
  id: row.id,
  ownerId: row.user_id,
  title: row.title as TaskTitle,
  description: row.description as TaskDescription | null,
  completed: row.is_completed,
});

// Ownership is enforced by `user_id = $n` in every statement, not by callers.
export const taskRepository = (db: Db): TaskRepository => ({
  listByOwner: async (ownerId) =>
    (await db.file<TaskRow[]>(queryPath('tasks/list'), [ownerId])).map(toTask),
  findByOwner: async (ownerId, taskId) => {
    const [row] = await db.file<TaskRow[]>(queryPath('tasks/find'), [taskId, ownerId]);
    return row && toTask(row);
  },
  add: async (ownerId, { title, description }) => {
    await db.file(queryPath('tasks/create'), [ownerId, title, description]);
  },
  update: async (ownerId, taskId, { title, description }) =>
    (await db.file(queryPath('tasks/edit'), [taskId, ownerId, title, description])).length > 0,
  toggleCompleted: async (ownerId, taskId) =>
    (await db.file(queryPath('tasks/toggle'), [taskId, ownerId])).length > 0,
  remove: async (ownerId, taskId) =>
    (await db.file(queryPath('tasks/delete'), [taskId, ownerId])).length > 0,
});
