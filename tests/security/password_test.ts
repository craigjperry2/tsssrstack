import { argon2PasswordHasher as hasher } from '../../src/app/adapters/security/password.ts';
import { assert, assertEquals } from '../support/assert.ts';

Deno.test('Argon2id hashes are salted PHC strings that verify only the right password', async () => {
  const first = await hasher.hash('correct-horse-battery');
  const second = await hasher.hash('correct-horse-battery');
  assert(first.startsWith('$argon2id$v=19$m=65536,t=3,p=1$'), first);
  assert(first !== second, 'each hash has its own salt');
  assertEquals(await hasher.verify('correct-horse-battery', first), true);
  assertEquals(await hasher.verify('correct-horse-batterz', first), false);
  assertEquals(await hasher.verify('correct-horse-battery', 'not-a-phc-string'), false);
});

type DeriveBits = typeof crypto.subtle.deriveBits;

// Runs body with crypto.subtle.deriveBits replaced, restoring the original afterwards.
async function withDeriveBits(replacement: DeriveBits, body: () => Promise<void>) {
  const original = crypto.subtle.deriveBits;
  crypto.subtle.deriveBits = replacement;
  try {
    await body();
  } finally {
    crypto.subtle.deriveBits = original;
  }
}

Deno.test('verifying without a stored hash does one identical Argon2id derivation', async () => {
  const real = await hasher.hash('a-real-password');
  const original = crypto.subtle.deriveBits.bind(crypto.subtle);
  const calls: unknown[] = [];
  const spy: DeriveBits = (algorithm, key, length) => {
    const { name, memory, passes, parallelism } = algorithm as Algorithm & Record<string, unknown>;
    calls.push({ name, memory, passes, parallelism, length });
    return original(algorithm, key, length);
  };
  const derivations = async (hash: string | undefined) => {
    calls.length = 0;
    await withDeriveBits(spy, async () => {
      assertEquals(await hasher.verify('any-password-at-all', hash), false);
    });
    return [...calls];
  };
  const withHash = await derivations(real);
  const without = await derivations(undefined);
  // Skipping Argon2 for unknown emails would make signing in reveal which accounts exist.
  assertEquals(withHash, [
    { name: 'Argon2id', memory: 65536, passes: 3, parallelism: 1, length: 256 },
  ]);
  assertEquals(without, withHash);
});

// The adapter's dummy PHC string, copied from src/app/adapters/security/password.ts. Its last
// segment is the 32-byte hash that a derivation would have to produce to match it.
const dummyHash =
  '$argon2id$v=19$m=65536,t=3,p=1$MDEyMzQ1Njc4OWFiY2RlZg$6VcbVD4_7DRhmJYF2BLo1MoROci40oH3Yx4kqPFSRo0';

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(
    atob(base64 + '='.repeat((4 - base64.length % 4) % 4)),
    (c) => c.charCodeAt(0),
  );
}

Deno.test('verifying without a stored hash is false even if the dummy hash matches', async () => {
  const dummyBytes = base64UrlDecode(dummyHash.split('$').at(-1)!);
  assertEquals(dummyBytes.length, 32);
  await withDeriveBits(() => Promise.resolve(dummyBytes.slice().buffer), async () => {
    assertEquals(await hasher.verify('anything', undefined), false);
    // Control: the stub really does make the dummy hash match.
    assertEquals(await hasher.verify('anything', dummyHash), true);
  });
});
