# 0003: Due dates are calendar days, judged against today in UTC

- Status: accepted
- Date: 2026-10-09

## Context

Tasks can have a due date, and the list flags overdue tasks. "Overdue" depends on what today is, and
that depends on a time zone. The server's zone is an accident of deployment, and browsers report
whatever the device is set to. Neither should silently decide a business rule.

## Decision

- A due date is a calendar day (`CalendarDate`, YYYY-MM-DD) with no time or zone. It is stored as
  PostgreSQL `date` and crosses the database boundary as text, so neither the driver nor the session
  time zone can shift it.
- A task is overdue when it is not completed and its due date is before today. A task due today is
  not overdue yet. Past dates may be entered.
- Today is the current date in UTC, taken from the `Clock` port. The task list reads the clock once,
  so every task in one response is judged against the same day. The form says this ("by UTC date").
- Overdue is derived when the list is read, never stored.

## Consequences

- The rule is deterministic, and it is tested with a fixed clock on both sides of midnight.
- Near midnight, users far from UTC see tasks become overdue earlier or later than their local
  calendar suggests. If that matters, the next step is a per-user time zone on the account, with the
  conversion done in the application layer. The `Clock` port and `utcDateOf` are the only places
  that would change.
- An open page does not flip a task to overdue at midnight. The next request does.
