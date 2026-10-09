import type { UserRepository } from '../../application/ports/user-repository.ts';
import type { Account, EmailAddress } from '../../domain/identity.ts';
import { type Db, queryPath } from './client.ts';

type UserRow = {
  id: number;
  email_normalized: string;
  password_hash: string;
  session_version: number;
};

// Emails were normalised by the domain before they were stored, and the app.email_address domain
// refuses anything unnormalised.
const toAccount = (row: UserRow): Account => ({
  id: row.id,
  email: row.email_normalized as EmailAddress,
  passwordHash: row.password_hash,
  sessionVersion: row.session_version,
});
const first = (rows: UserRow[]) => rows[0] && toAccount(rows[0]);

export const userRepository = (db: Db): UserRepository => ({
  findByEmail: async (email) =>
    first(await db.file<UserRow[]>(queryPath('users/by_email'), [email])),
  findById: async (id) => first(await db.file<UserRow[]>(queryPath('users/by_id'), [id])),
  // ON CONFLICT DO NOTHING returns no row for a taken email, without raising an error.
  create: async (email, passwordHash) =>
    first(await db.file<UserRow[]>(queryPath('users/create'), [email, passwordHash])),
  replacePassword: async (id, passwordHash) =>
    toAccount(
      (await db.file<UserRow[]>(queryPath('users/change_password'), [id, passwordHash]))[0],
    ),
});
