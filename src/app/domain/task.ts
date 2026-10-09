import { type Brand, codePoints, err, ok, type Result } from './shared.ts';

// A task belongs to exactly one owner for its whole life; every lookup and change is scoped to
// that owner.
export type Task = Readonly<{
  id: number;
  ownerId: number;
  title: TaskTitle;
  description: TaskDescription | null;
  completed: boolean;
}>;

// The user-editable part of a task, valid as a whole.
export type TaskDetails = Readonly<{ title: TaskTitle; description: TaskDescription | null }>;
export type TaskProblems = Readonly<{ title?: 'required' | 'tooLong'; description?: 'tooLong' }>;

// Non-blank, at most 200 code points, stored trimmed.
export type TaskTitle = Brand<string, 'TaskTitle'>;
export function parseTaskTitle(raw: string): Result<TaskTitle, 'required' | 'tooLong'> {
  const title = raw.trim();
  if (!title) return err('required');
  return codePoints(title) > 200 ? err('tooLong') : ok(title as TaskTitle);
}

// Free text of at most 5,000 code points, kept as typed. Empty means no description.
export type TaskDescription = Brand<string, 'TaskDescription'>;
export function parseTaskDescription(raw: string): Result<TaskDescription | null, 'tooLong'> {
  if (codePoints(raw) > 5000) return err('tooLong');
  return ok(raw ? raw as TaskDescription : null);
}

// Reports every invalid field at once, so a form can show all of them together.
export function parseTaskDetails(
  input: Readonly<{ title: string; description: string }>,
): Result<TaskDetails, TaskProblems> {
  const title = parseTaskTitle(input.title);
  const description = parseTaskDescription(input.description);
  if (title.ok && description.ok) {
    return ok({ title: title.value, description: description.value });
  }
  return err({
    ...(!title.ok && { title: title.error }),
    ...(!description.ok && { description: description.error }),
  });
}
