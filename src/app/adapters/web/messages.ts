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
