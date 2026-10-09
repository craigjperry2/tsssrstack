import { test } from 'node:test';
import { parseCalendarDate, utcDateOf } from '../../src/app/domain/calendar.ts';
import { assertEquals } from '../support/assert.ts';

test('calendar dates must be real days written YYYY-MM-DD', () => {
  for (const valid of ['2028-02-29', '2026-12-31', '0001-01-01', '0099-06-15']) {
    assertEquals([valid, parseCalendarDate(valid).ok], [valid, true]);
  }
  const invalid = [
    '2027-02-29', // not a leap year
    '2100-02-29', // century years are leap years only when divisible by 400
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '0000-01-01', // there is no year zero
    '2026-1-01',
    '2026-10-09T00:00:00Z',
    ' 2026-10-09',
  ];
  for (const raw of invalid) assertEquals([raw, parseCalendarDate(raw).ok], [raw, false]);
});

test("today is the instant's date in UTC, not in the server's zone", () => {
  assertEquals(utcDateOf(new Date('2026-10-09T23:30:00-05:00')), '2026-10-10');
  assertEquals(utcDateOf(new Date('2026-10-10T00:30:00+01:00')), '2026-10-09');
});
