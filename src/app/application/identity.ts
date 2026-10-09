import {
  checkPassword,
  parseEmail,
  type PasswordProblem,
  type Principal,
  principalOf,
} from '../domain/identity.ts';
import { err, ok, type Result } from '../domain/shared.ts';
import type { PasswordHasher } from './ports/password-hasher.ts';
import type { UserRepository } from './ports/user-repository.ts';

// Account use cases. Sessions and cookies are the driving adapter's concern: these operations
// return a Principal for it to remember, and resolve one it presents later.
export type RegistrationError = 'invalidEmail' | PasswordProblem | 'emailInUse';
export type PasswordChangeError = 'wrongPassword' | PasswordProblem;

export function identityService(
  { users, passwords }: Readonly<{ users: UserRepository; passwords: PasswordHasher }>,
) {
  return {
    async register(
      rawEmail: string,
      password: string,
    ): Promise<Result<Principal, RegistrationError>> {
      const email = parseEmail(rawEmail);
      if (!email.ok) return err('invalidEmail');
      const problem = checkPassword(password, email.value);
      if (problem) return err(problem);
      const account = await users.create(email.value, await passwords.hash(password));
      return account ? ok(principalOf(account)) : err('emailInUse');
    },

    // One failure for every reason, so the response does not reveal which emails exist.
    async logIn(
      rawEmail: string,
      password: string,
    ): Promise<Result<Principal, 'invalidCredentials'>> {
      const email = parseEmail(rawEmail);
      const account = email.ok ? await users.findByEmail(email.value) : undefined;
      const verified = await passwords.verify(password, account?.passwordHash);
      return account && verified ? ok(principalOf(account)) : err('invalidCredentials');
    },

    async changePassword(
      userId: number,
      currentPassword: string,
      newPassword: string,
    ): Promise<Result<Principal, PasswordChangeError>> {
      const account = await users.findById(userId);
      if (!account || !await passwords.verify(currentPassword, account.passwordHash)) {
        return err('wrongPassword');
      }
      const problem = checkPassword(newPassword, account.email);
      if (problem) return err(problem);
      return ok(
        principalOf(await users.replacePassword(userId, await passwords.hash(newPassword))),
      );
    },

    // The principal for a session, unless a password change has since revoked it.
    async resolve(userId: number, sessionVersion: number): Promise<Principal | undefined> {
      const account = await users.findById(userId);
      return account?.sessionVersion === sessionVersion ? principalOf(account) : undefined;
    },
  };
}
export type IdentityService = ReturnType<typeof identityService>;
