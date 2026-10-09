import { test } from 'node:test';
import { checkPassword, type EmailAddress, parseEmail } from '../../src/app/domain/identity.ts';
import { assertEquals } from '../support/assert.ts';

test('an email address is trimmed and lowercased', () => {
  assertEquals(parseEmail('  Person@Example.TEST  '), { ok: true, value: 'person@example.test' });
});

test('malformed or oversized email addresses are rejected', () => {
  for (const raw of ['', 'person', 'person@example', 'two words@example.test', '@example.test']) {
    assertEquals([raw, parseEmail(raw).ok], [raw, false]);
  }
  const local = 'a'.repeat(64);
  assertEquals(parseEmail(`${local}@${'b'.repeat(320 - 64 - 6)}.test`).ok, true);
  assertEquals(parseEmail(`${local}@${'b'.repeat(320 - 64 - 5)}.test`).ok, false);
});

test('password length counts code points, from 12 to 128', () => {
  const email = 'person@example.test' as EmailAddress;
  // Eleven emoji are 22 UTF-16 code units, which a .length check would wrongly accept.
  assertEquals(checkPassword('😀'.repeat(11), email), 'length');
  assertEquals(checkPassword('😀'.repeat(12), email), undefined);
  assertEquals(checkPassword('a'.repeat(128), email), undefined);
  assertEquals(checkPassword('a'.repeat(129), email), 'length');
});

test('passwords must not have surrounding whitespace or contain the email', () => {
  const email = 'person@example.test' as EmailAddress;
  assertEquals(checkPassword(' a-long-enough-password', email), 'surroundingWhitespace');
  assertEquals(checkPassword('my PERSON@example.test pass', email), 'containsEmail');
  assertEquals(checkPassword('a-long-enough-password', email), undefined);
});
