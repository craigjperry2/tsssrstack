import { userRepository } from '../../src/app/adapters/persistence/user-repository.ts';
import { type EmailAddress, parseEmail } from '../../src/app/domain/identity.ts';
import { assert, assertEquals } from '../support/assert.ts';
import { dbTest, fakeArgon2Hash, uniqueEmail } from '../support/db.ts';

const email = (name: string) => {
  const parsed = parseEmail(uniqueEmail(name));
  if (!parsed.ok) throw new Error('invalid test email');
  return parsed.value as EmailAddress;
};

dbTest('creating an account with a taken email returns nothing and changes nothing', async (db) => {
  const users = userRepository(db);
  const address = email('person');
  const account = await users.create(address, fakeArgon2Hash('first'));
  assert(account, 'created');
  assertEquals(
    [account.email, account.passwordHash, account.sessionVersion],
    [address, fakeArgon2Hash('first'), 0],
  );
  assertEquals(await users.create(address, fakeArgon2Hash('second')), undefined);
  assertEquals(await users.findByEmail(address), account);
  assertEquals(await users.findById(account.id), account);
});

dbTest('replacing a password bumps the session version in the same statement', async (db) => {
  const users = userRepository(db);
  const account = (await users.create(email('person'), fakeArgon2Hash('old')))!;
  const replaced = await users.replacePassword(account.id, fakeArgon2Hash('new'));
  assertEquals(replaced, { ...account, passwordHash: fakeArgon2Hash('new'), sessionVersion: 1 });
  assertEquals(
    (await users.replacePassword(account.id, fakeArgon2Hash('newer'))).sessionVersion,
    2,
  );
});
