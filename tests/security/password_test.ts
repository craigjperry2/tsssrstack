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

Deno.test('verifying without a stored hash fails after doing the same work', async () => {
  const time = async (hash: string | undefined) => {
    const start = performance.now();
    assertEquals(await hasher.verify('any-password-at-all', hash), false);
    return performance.now() - start;
  };
  const real = await hasher.hash('a-real-password');
  const [withHash, without] = [await time(real), await time(undefined)];
  // Skipping Argon2 for unknown emails would make this orders of magnitude faster.
  assert(without > withHash / 4, `unknown: ${without}ms, known: ${withHash}ms`);
});
