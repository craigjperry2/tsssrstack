import type { Account, EmailAddress } from '../../domain/identity.ts';

// Driven port for account storage.
export interface UserRepository {
  findByEmail(email: EmailAddress): Promise<Account | undefined>;
  findById(id: number): Promise<Account | undefined>;
  // Undefined when the email is already registered; an existing account is never changed.
  create(email: EmailAddress, passwordHash: string): Promise<Account | undefined>;
  // Stores the new hash and increments the session version in one atomic step.
  replacePassword(id: number, passwordHash: string): Promise<Account>;
}
