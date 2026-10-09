import type { CalendarDate } from '../../src/app/domain/calendar.ts';
import {
  isOverdue,
  parseDueDate,
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
  assertEquals(
    parseTaskDetails({ title: '', description: 'x'.repeat(5001), dueDate: '2026-02-30' }),
    {
      ok: false,
      error: { title: 'required', description: 'tooLong', dueDate: 'invalid' },
    },
  );
  assertEquals(parseTaskDetails({ title: ' Plan ', description: '', dueDate: '' }), {
    ok: true,
    value: { title: 'Plan', description: null, dueDate: null },
  });
});

Deno.test('a due date is optional and may be in the past', () => {
  assertEquals(parseDueDate(''), { ok: true, value: null });
  assertEquals(parseDueDate('1999-12-31'), { ok: true, value: '1999-12-31' });
});

Deno.test('a task is overdue only after its due date, and never once completed', () => {
  const today = '2026-10-09' as CalendarDate;
  const task = (dueDate: string | null, completed = false) => ({
    dueDate: dueDate as CalendarDate | null,
    completed,
  });
  assertEquals(isOverdue(task('2026-10-08'), today), true);
  assertEquals(isOverdue(task('2026-10-09'), today), false);
  assertEquals(isOverdue(task('2026-10-10'), today), false);
  assertEquals(isOverdue(task(null), today), false);
  assertEquals(isOverdue(task('2026-10-08', true), today), false);
  // String comparison must order by date across month and year boundaries.
  assertEquals(isOverdue(task('2025-12-31'), '2026-01-01' as CalendarDate), true);
  assertEquals(isOverdue(task('2026-09-30'), today), true);
});
