import type { PasswordHasher } from '../../src/app/application/ports/password-hasher.ts';
import type { TaskRepository } from '../../src/app/application/ports/task-repository.ts';
import type { UserRepository } from '../../src/app/application/ports/user-repository.ts';
import type { Account } from '../../src/app/domain/identity.ts';
import type { Task } from '../../src/app/domain/task.ts';

// Implements the UserRepository contract in memory, including email uniqueness.
export function memoryUserRepository(): UserRepository {
  const accounts: Account[] = [];
  return {
    findByEmail: (email) => Promise.resolve(accounts.find((account) => account.email === email)),
    findById: (id) => Promise.resolve(accounts.find((account) => account.id === id)),
    create: (email, passwordHash) => {
      if (accounts.some((account) => account.email === email)) return Promise.resolve(undefined);
      const account = { id: accounts.length + 1, email, passwordHash, sessionVersion: 0 };
      accounts.push(account);
      return Promise.resolve(account);
    },
    replacePassword: (id, passwordHash) => {
      const index = accounts.findIndex((account) => account.id === id);
      const current = accounts[index];
      accounts[index] = { ...current, passwordHash, sessionVersion: current.sessionVersion + 1 };
      return Promise.resolve(accounts[index]);
    },
  };
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

// Fast and transparent instead of Argon2id; records what verify was asked to check.
export function fakePasswords(): PasswordHasher & { verified: (string | undefined)[] } {
  const verified: (string | undefined)[] = [];
  return {
    verified,
    hash: (password) => Promise.resolve(`hashed:${password}`),
    verify: (password, hash) => {
      verified.push(hash);
      return Promise.resolve(hash === `hashed:${password}`);
    },
  };
}
