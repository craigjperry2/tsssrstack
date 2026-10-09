import { test } from 'node:test';
import { identityService } from '../../src/app/application/identity.ts';
import { assert, assertEquals } from '../support/assert.ts';
import { fakePasswords, memoryUserRepository } from '../support/fakes.ts';

const password = 'correct-horse-battery';
const setup = () => {
  const users = memoryUserRepository();
  const passwords = fakePasswords();
  return { users, passwords, identity: identityService({ users, passwords }) };
};

test('registration stores a hash and never replaces an existing account', async () => {
  const { users, identity } = setup();
  const registered = await identity.register(' Person@Example.TEST ', password);
  assert(registered.ok, 'registered');
  assertEquals(registered.value.email, 'person@example.test');
  assertEquals((await users.findById(registered.value.id))?.passwordHash, `hashed:${password}`);
  assertEquals(await identity.register('person@example.test', 'a-different-password'), {
    ok: false,
    error: 'emailInUse',
  });
  assertEquals((await users.findById(registered.value.id))?.passwordHash, `hashed:${password}`);
});

test('registration reports the first problem with the email, then the password', async () => {
  const { identity } = setup();
  assertEquals(await identity.register('nope', 'short'), { ok: false, error: 'invalidEmail' });
  assertEquals(await identity.register('a@b.test', 'short'), { ok: false, error: 'length' });
});

test('an unknown email still costs a password verification', async () => {
  const { passwords, identity } = setup();
  assertEquals(await identity.logIn('who@example.test', password), {
    ok: false,
    error: 'invalidCredentials',
  });
  // The adapter turns `undefined` into a dummy-hash verification of equal cost.
  assertEquals(passwords.verified, [undefined]);
});

test('a password change revokes sessions at the previous version', async () => {
  const { identity } = setup();
  const registered = await identity.register('person@example.test', password);
  assert(registered.ok, 'registered');
  const { id, sessionVersion } = registered.value;

  assertEquals(await identity.changePassword(id, 'wrong-password', 'another-long-password'), {
    ok: false,
    error: 'wrongPassword',
  });
  assertEquals((await identity.resolve(id, sessionVersion))?.id, id);
  assertEquals(await identity.changePassword(id, password, 'x person@example.test x'), {
    ok: false,
    error: 'containsEmail',
  });

  const changed = await identity.changePassword(id, password, 'another-long-password');
  assert(changed.ok, 'changed');
  assertEquals(changed.value.sessionVersion, sessionVersion + 1);
  assertEquals(await identity.resolve(id, sessionVersion), undefined);
  assertEquals((await identity.resolve(id, changed.value.sessionVersion))?.id, id);
  assertEquals((await identity.logIn('person@example.test', 'another-long-password')).ok, true);
});
