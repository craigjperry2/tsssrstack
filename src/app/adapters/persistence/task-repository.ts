import type { TaskRepository } from '../../application/ports/task-repository.ts';
import type { CalendarDate } from '../../domain/calendar.ts';
import type { Task, TaskDescription, TaskTitle } from '../../domain/task.ts';
import { type Db, queryPath } from './client.ts';

// Row shapes stay private to the adapter; the rest of the system sees domain types.
type TaskRow = {
  id: number;
  user_id: number;
  title: string;
  description: string | null;
  due_date: string | null;
  is_completed: boolean;
};

// Stored values were validated on the way in, and the columns' PostgreSQL domains refuse anything
// the value types would reject (migrations/003, docs/adr/0004), so rows are trusted to satisfy them.
const toTask = (row: TaskRow): Task => ({
  id: row.id,
  ownerId: row.user_id,
  title: row.title as TaskTitle,
  description: row.description as TaskDescription | null,
  dueDate: row.due_date as CalendarDate | null,
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
  add: async (ownerId, { title, description, dueDate }) => {
    await db.file(queryPath('tasks/create'), [ownerId, title, description, dueDate]);
  },
  update: async (ownerId, taskId, { title, description, dueDate }) =>
    (await db.file(queryPath('tasks/edit'), [taskId, ownerId, title, description, dueDate]))
      .length > 0,
  toggleCompleted: async (ownerId, taskId) =>
    (await db.file(queryPath('tasks/toggle'), [taskId, ownerId])).length > 0,
  remove: async (ownerId, taskId) =>
    (await db.file(queryPath('tasks/delete'), [taskId, ownerId])).length > 0,
});
