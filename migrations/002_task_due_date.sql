-- A calendar day with no time zone; overdue is derived from it, never stored.
ALTER TABLE app.tasks ADD COLUMN due_date date;
