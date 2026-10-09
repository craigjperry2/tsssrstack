-- due_date crosses the boundary as YYYY-MM-DD text, so no driver or session time zone can shift it.
SELECT id, user_id, title, description, to_char(due_date, 'YYYY-MM-DD') AS due_date, is_completed
FROM app.tasks WHERE id = $1 AND user_id = $2;
