import type { Task, TaskDetails } from '../../domain/task.ts';

// Driven port for task storage. Every method is scoped to an owner: an implementation must never
// read or change another owner's task, and reports "no such task" (undefined or false) instead.
// Each change is a single atomic operation.
export interface TaskRepository {
  // Newest first.
  listByOwner(ownerId: number): Promise<Task[]>;
  findByOwner(ownerId: number, taskId: number): Promise<Task | undefined>;
  add(ownerId: number, details: TaskDetails): Promise<void>;
  update(ownerId: number, taskId: number, details: TaskDetails): Promise<boolean>;
  toggleCompleted(ownerId: number, taskId: number): Promise<boolean>;
  remove(ownerId: number, taskId: number): Promise<boolean>;
}
