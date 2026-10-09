import {
  parseTaskDescription,
  parseTaskDetails,
  parseTaskTitle,
} from '../../src/app/domain/task.ts';
import { assertEquals } from '../support/assert.ts';

Deno.test('a task title is trimmed and must not be blank', () => {
  assertEquals(parseTaskTitle('  Buy milk  '), { ok: true, value: 'Buy milk' });
  assertEquals(parseTaskTitle(' \t\n'), { ok: false, error: 'required' });
});

Deno.test('title length counts code points after trimming', () => {
  // 200 emoji are 400 UTF-16 code units but 200 characters, which PostgreSQL also accepts.
  assertEquals(parseTaskTitle('😀'.repeat(200)).ok, true);
  assertEquals(parseTaskTitle(`  ${'a'.repeat(200)}  `).ok, true);
  assertEquals(parseTaskTitle('a'.repeat(201)), { ok: false, error: 'tooLong' });
});

Deno.test('a description is optional, kept as typed, and bounded', () => {
  assertEquals(parseTaskDescription(''), { ok: true, value: null });
  assertEquals(parseTaskDescription('  indented'), { ok: true, value: '  indented' });
  assertEquals(parseTaskDescription('é'.repeat(5000)).ok, true);
  assertEquals(parseTaskDescription('é'.repeat(5001)), { ok: false, error: 'tooLong' });
});

Deno.test('task details report every invalid field together', () => {
  assertEquals(parseTaskDetails({ title: '', description: 'x'.repeat(5001) }), {
    ok: false,
    error: { title: 'required', description: 'tooLong' },
  });
  assertEquals(parseTaskDetails({ title: ' Plan ', description: '' }), {
    ok: true,
    value: { title: 'Plan', description: null },
  });
});
