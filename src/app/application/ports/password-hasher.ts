// Driven port for one-way password hashing.
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  // Without a stored hash it still does comparable work and returns false, so signing in with
  // an unknown email takes as long as signing in with a wrong password.
  verify(password: string, hash: string | undefined): Promise<boolean>;
}
