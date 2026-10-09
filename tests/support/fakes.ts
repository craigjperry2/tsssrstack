import type { Task, User } from '../../src/app/adapters/persistence/repositories.ts';
import type { WebDeps } from '../../src/app/adapters/web/context.tsx';

// In-memory stand-ins for the persistence adapter, enforcing the same ownership and uniqueness
// rules as the SQL.
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

export function memoryTasks(): WebDeps['tasks'] {
  let rows: (Task & { user_id: number })[] = [];
  let nextId = 1;
  const owned = (id: number, userId: number) =>
    rows.filter((task) => task.id === id && task.user_id === userId);
  return {
    list: (userId: number) =>
      Promise.resolve(
        rows.filter((task) => task.user_id === userId).map(({ user_id: _, ...task }) => task)
          .reverse(),
      ),
    create: (userId: number, title: string, description: string) => {
      rows.push({
        id: nextId++,
        user_id: userId,
        title,
        description: description || null,
        is_completed: false,
      });
      return Promise.resolve();
    },
    edit: (id: number, userId: number, title: string, description: string) =>
      Promise.resolve(
        owned(id, userId).map((task) =>
          Object.assign(task, { title, description: description || null })
        ),
      ),
    toggle: (id: number, userId: number) =>
      Promise.resolve(
        owned(id, userId).map((task) => Object.assign(task, { is_completed: !task.is_completed })),
      ),
    delete: (id: number, userId: number) => {
      const removed = owned(id, userId);
      rows = rows.filter((task) => !removed.includes(task));
      return Promise.resolve(removed);
    },
  } as unknown as WebDeps['tasks'];
}

export const fakePasswords = {
  hash: (password: string) => Promise.resolve(`plain:${password}`),
  verify: (password: string, hash: string) => Promise.resolve(hash === `plain:${password}`),
};
