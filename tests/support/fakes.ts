import type { User } from '../../src/app/adapters/persistence/repositories.ts';
import type { TaskRepository } from '../../src/app/application/ports/task-repository.ts';
import type { Task } from '../../src/app/domain/task.ts';
import type { WebDeps } from '../../src/app/adapters/web/context.tsx';

// In-memory stand-ins for the persistence adapter, enforcing the same uniqueness rule as the SQL.
export function memoryUsers(): WebDeps['users'] {
  const rows: User[] = [];
  return {
    byEmail: (email: string) =>
      Promise.resolve(rows.find((user) => user.email_normalized === email)),
    byId: (id: number) => Promise.resolve(rows.find((user) => user.id === id)),
    create: (email: string, hash: string) => {
      if (rows.some((user) => user.email_normalized === email)) {
        return Promise.reject(new Error('duplicate key'));
      }
      const user = {
        id: rows.length + 1,
        email_normalized: email,
        password_hash: hash,
        session_version: 0,
      };
      rows.push(user);
      return Promise.resolve(user);
    },
    changePassword: (id: number, hash: string) => {
      const user = rows.find((row) => row.id === id)!;
      Object.assign(user, { password_hash: hash, session_version: user.session_version + 1 });
      return Promise.resolve({ ...user });
    },
  } as unknown as WebDeps['users'];
}

// Implements the TaskRepository contract in memory, including owner scoping.
export function memoryTaskRepository(): TaskRepository {
  const rows: Task[] = [];
  let nextId = 1;
  const owned = (ownerId: number, taskId: number) =>
    rows.find((task) => task.id === taskId && task.ownerId === ownerId);
  // Replaces the owned task with update's result, or deletes it when that is null.
  const change = (ownerId: number, taskId: number, update: (task: Task) => Task | null) => {
    const task = owned(ownerId, taskId);
    if (!task) return Promise.resolve(false);
    const updated = update(task);
    rows.splice(rows.indexOf(task), 1, ...(updated ? [updated] : []));
    return Promise.resolve(true);
  };
  return {
    listByOwner: (ownerId) =>
      Promise.resolve(rows.filter((task) => task.ownerId === ownerId).reverse()),
    findByOwner: (ownerId, taskId) => Promise.resolve(owned(ownerId, taskId)),
    add: (ownerId, details) => {
      rows.push({ id: nextId++, ownerId, completed: false, ...details });
      return Promise.resolve();
    },
    update: (ownerId, taskId, details) =>
      change(ownerId, taskId, (task) => ({ ...task, ...details })),
    toggleCompleted: (ownerId, taskId) =>
      change(ownerId, taskId, (task) => ({ ...task, completed: !task.completed })),
    remove: (ownerId, taskId) => change(ownerId, taskId, () => null),
  };
}

export const fakePasswords = {
  hash: (password: string) => Promise.resolve(`plain:${password}`),
  verify: (password: string, hash: string) => Promise.resolve(hash === `plain:${password}`),
};
