import type { PasswordChangeError, RegistrationError } from '../../application/identity.ts';
import type { PasswordProblem } from '../../domain/identity.ts';
import type { TaskProblems } from '../../domain/task.ts';

// User-facing wording for domain problems. The domain names what is wrong; presentation is
// the web adapter's job.
const taskMessages = {
  title: {
    required: 'Title is required.',
    tooLong: 'Title must be at most 200 characters.',
  },
  description: { tooLong: 'Description must be at most 5,000 characters.' },
} as const;

export function taskErrors(problems: TaskProblems): Record<string, string> {
  const errors: Record<string, string> = {};
  if (problems.title) errors.title = taskMessages.title[problems.title];
  if (problems.description) errors.description = taskMessages.description[problems.description];
  return errors;
}

const passwordMessages: Record<PasswordProblem, string> = {
  length: 'Password must be 12 to 128 characters.',
  surroundingWhitespace: 'Password must not start or end with whitespace.',
  containsEmail: 'Password must not contain your email address.',
};

export const registrationMessage = (error: RegistrationError): string =>
  error === 'invalidEmail'
    ? 'Enter a valid email address.'
    // Deliberately vague, like the login failure message.
    : error === 'emailInUse'
    ? 'Unable to create that account.'
    : passwordMessages[error];

export const loginMessage = 'Invalid email or password.';

export const passwordChangeMessage = (error: PasswordChangeError): string =>
  error === 'wrongPassword' ? 'Current password is incorrect.' : passwordMessages[error];
