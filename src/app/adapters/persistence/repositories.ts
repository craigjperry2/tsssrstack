import type { Sql } from 'postgres';
import { queryPath } from './client.ts';
export type User = {
  id: number;
  email_normalized: string;
  password_hash: string;
  session_version: number;
};
export type Task = { id: number; title: string; description: string | null; is_completed: boolean };
export const users = (sql: Sql) => ({
  byEmail: (email: string) =>
    sql.file<User[]>(queryPath('users/by_email'), [email]).then((r) => r[0]),
  byId: (id: number) => sql.file<User[]>(queryPath('users/by_id'), [id]).then((r) => r[0]),
  create: (email: string, hash: string) =>
    sql.file<User[]>(queryPath('users/create'), [email, hash]).then((r) => r[0]),
  changePassword: (id: number, hash: string) =>
    sql.file<User[]>(queryPath('users/change_password'), [id, hash]).then((r) => r[0]),
});
export const tasks = (sql: Sql) => ({
  list: (userId: number) => sql.file<Task[]>(queryPath('tasks/list'), [userId]),
  create: (userId: number, title: string, description: string) =>
    sql.file(queryPath('tasks/create'), [userId, title, description]),
  edit: (id: number, userId: number, title: string, description: string) =>
    sql.file<Task[]>(queryPath('tasks/edit'), [id, userId, title, description]),
  toggle: (id: number, userId: number) => sql.file<Task[]>(queryPath('tasks/toggle'), [id, userId]),
  delete: (id: number, userId: number) => sql.file<Task[]>(queryPath('tasks/delete'), [id, userId]),
});
