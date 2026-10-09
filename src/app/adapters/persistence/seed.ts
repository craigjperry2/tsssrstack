import type { Sql } from 'postgres';
import { hashPassword } from '../security/password.ts';
import { queryPath } from './client.ts';
import type { User } from './repositories.ts';

export const devUserEmail = 'dev@example.com';
export const devUserPassword = 'devdevdevdev';

// Development convenience only: gated on ENV=development at the call site in main.tsx,
// and a no-op if the account already exists, so a dev-changed password is never clobbered.
export async function seedDevUser(sql: Sql): Promise<User | undefined> {
  return (await sql.file<User[]>(
    queryPath('users/create_if_absent'),
    [devUserEmail, await hashPassword(devUserPassword)],
  ))[0];
}
