import { userRepository } from '../../src/app/adapters/persistence/user-repository.ts';
import { type EmailAddress, parseEmail } from '../../src/app/domain/identity.ts';
import { assert, assertEquals } from '../support/assert.ts';
import { dbTest, uniqueEmail } from '../support/db.ts';

const email = (name: string) => {
  const parsed = parseEmail(uniqueEmail(name));
  if (!parsed.ok) throw new Error('invalid test email');
  return parsed.value as EmailAddress;
};

dbTest('creating an account with a taken email returns nothing and changes nothing', async (db) => {
  const users = userRepository(db);
  const address = email('person');
  const account = await users.create(address, 'first-hash');
  assert(account, 'created');
  assertEquals([account.email, account.passwordHash, account.sessionVersion], [
    address,
    'first-hash',
    0,
  ]);
  assertEquals(await users.create(address, 'second-hash'), undefined);
  assertEquals(await users.findByEmail(address), account);
  assertEquals(await users.findById(account.id), account);
});

dbTest('replacing a password bumps the session version in the same statement', async (db) => {
  const users = userRepository(db);
  const account = (await users.create(email('person'), 'old-hash'))!;
  const replaced = await users.replacePassword(account.id, 'new-hash');
  assertEquals(replaced, { ...account, passwordHash: 'new-hash', sessionVersion: 1 });
  assertEquals((await users.replacePassword(account.id, 'newer-hash')).sessionVersion, 2);
});
