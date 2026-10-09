import { type Brand, codePoints, err, ok, type Result } from './shared.ts';

// Trimmed and lowercased, so one mailbox maps to one account.
export type EmailAddress = Brand<string, 'EmailAddress'>;
export function parseEmail(raw: string): Result<EmailAddress, 'invalid'> {
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) && email.length <= 320
    ? ok(email as EmailAddress)
    : err('invalid');
}

export type PasswordProblem = 'length' | 'surroundingWhitespace' | 'containsEmail';
export function checkPassword(password: string, email: EmailAddress): PasswordProblem | undefined {
  const length = codePoints(password);
  if (length < 12 || length > 128) return 'length';
  if (password !== password.trim()) return 'surroundingWhitespace';
  if (password.toLowerCase().includes(email)) return 'containsEmail';
}

// An account holds credentials. sessionVersion increases whenever the password changes, which
// revokes every session issued before.
export type Account = Readonly<{
  id: number;
  email: EmailAddress;
  passwordHash: string;
  sessionVersion: number;
}>;

// The signed-in user as the rest of the application sees them: no credentials.
export type Principal = Readonly<{ id: number; email: EmailAddress; sessionVersion: number }>;
export const principalOf = ({ id, email, sessionVersion }: Account): Principal => ({
  id,
  email,
  sessionVersion,
});
