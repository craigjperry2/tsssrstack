import { normalizeEmail, taskInput, validatePassword } from '../src/app/domain/validation.ts';
const assertEquals = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
};

Deno.test('email normalization trims and lowercases consistently', () => {
  assertEquals(normalizeEmail('  Person@Example.TEST  '), 'person@example.test');
});

Deno.test('password validation enforces length, whitespace, and email exclusion', () => {
  assertEquals(
    validatePassword('short', 'person@example.test'),
    'Password must be 12 to 128 characters.',
  );
  assertEquals(
    validatePassword(' a-long-enough-password ', 'person@example.test'),
    'Password must not start or end with whitespace.',
  );
  assertEquals(
    validatePassword('person@example.test with padding', 'person@example.test'),
    'Password must not contain your email address.',
  );
  assertEquals(validatePassword('a-long-enough-password', 'person@example.test'), undefined);
});

Deno.test('task input is trimmed and bounded', () => {
  assertEquals(taskInput('  ', ''), { title: 'Title is required.' });
  assertEquals(taskInput('A task', 'a'.repeat(5001)), {
    description: 'Description must be at most 5,000 characters.',
  });
});
