export type FieldErrors = Record<string, string>;
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) && email.length <= 320;
}
export function validatePassword(password: string, normalizedEmail: string): string | undefined {
  const length = Array.from(password).length;
  if (length < 12 || length > 128) return 'Password must be 12 to 128 characters.';
  if (password !== password.trim()) return 'Password must not start or end with whitespace.';
  if (normalizedEmail && password.toLowerCase().includes(normalizedEmail)) {
    return 'Password must not contain your email address.';
  }
}
export function taskInput(title: string, description: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!title.trim()) errors.title = 'Title is required.';
  if (Array.from(title.trim()).length > 200) errors.title = 'Title must be at most 200 characters.';
  if (Array.from(description).length > 5000) {
    errors.description = 'Description must be at most 5,000 characters.';
  }
  return errors;
}
