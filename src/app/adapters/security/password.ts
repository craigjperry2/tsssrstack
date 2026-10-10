import type { PasswordHasher } from '../../application/ports/password-hasher.ts';
const encoder = new TextEncoder();
const parameters = { name: 'Argon2id', memory: 65536, passes: 3, parallelism: 1 } as const;
// WebCrypto Argon2 ("Modern Algorithms in WebCrypto"); @types/node doesn't declare it yet.
type Argon2Params = Algorithm & {
  nonce: BufferSource;
  memory: number;
  passes: number;
  parallelism: number;
};

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll(
    '=',
    '',
  );
}
function unb64(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') +
    '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}
function parsePhc(value: string): { salt: Uint8Array; hash: Uint8Array } | undefined {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/u.exec(
    value,
  );
  if (!m || m[1] !== '65536' || m[2] !== '3' || m[3] !== '1') return undefined;
  try {
    const salt = unb64(m[4]);
    const hash = unb64(m[5]);
    return salt.length === 16 && hash.length === 32 ? { salt, hash } : undefined;
  } catch {
    return undefined;
  }
}
async function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
  // 'raw-secret' is the format the spec defines for Argon2 keys; Node accepts only that one.
  // @types/node does not declare it yet, hence the cast.
  const key = await crypto.subtle.importKey(
    'raw-secret' as 'raw',
    encoder.encode(password),
    'Argon2id',
    false,
    ['deriveBits'],
  );
  const saltCopy = new ArrayBuffer(salt.byteLength);
  new Uint8Array(saltCopy).set(salt);
  const algorithm: Argon2Params = { ...parameters, nonce: saltCopy };
  return new Uint8Array(await crypto.subtle.deriveBits(algorithm, key, 256));
}
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `$argon2id$v=19$m=65536,t=3,p=1$${b64(salt)}$${b64(await derive(password, salt))}`;
}
async function verifyPassword(password: string, phc: string): Promise<boolean> {
  const parsed = parsePhc(phc);
  if (!parsed) return false;
  const actual = await derive(password, parsed.salt);
  let difference = actual.length ^ parsed.hash.length;
  for (let index = 0; index < Math.max(actual.length, parsed.hash.length); index++) {
    difference |= (actual[index] ?? 0) ^ (parsed.hash[index] ?? 0);
  }
  return difference === 0;
}

// A valid hash of an unguessable value, verified against when there is no stored hash so that
// the work done does not depend on whether the account exists.
const dummyHash =
  '$argon2id$v=19$m=65536,t=3,p=1$MDEyMzQ1Njc4OWFiY2RlZg$6VcbVD4_7DRhmJYF2BLo1MoROci40oH3Yx4kqPFSRo0';

export const argon2PasswordHasher: PasswordHasher = {
  hash: hashPassword,
  async verify(password, hash) {
    // Always do the work, and only then refuse a match against the dummy hash.
    const matched = await verifyPassword(password, hash ?? dummyHash);
    return hash !== undefined && matched;
  },
};
