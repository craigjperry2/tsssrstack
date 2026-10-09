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
