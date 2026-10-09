import { type Db, queryPath } from './client.ts';
export type User = {
  id: number;
  email_normalized: string;
  password_hash: string;
  session_version: number;
};
export const users = (sql: Db) => ({
  byEmail: (email: string) =>
    sql.file<User[]>(queryPath('users/by_email'), [email]).then((r) => r[0]),
  byId: (id: number) => sql.file<User[]>(queryPath('users/by_id'), [id]).then((r) => r[0]),
  create: (email: string, hash: string) =>
    sql.file<User[]>(queryPath('users/create'), [email, hash]).then((r) => r[0]),
  changePassword: (id: number, hash: string) =>
    sql.file<User[]>(queryPath('users/change_password'), [id, hash]).then((r) => r[0]),
});
