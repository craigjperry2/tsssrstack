SELECT id, user_id, title, description, to_char(due_date, 'YYYY-MM-DD') AS due_date, is_completed
FROM app.tasks WHERE user_id = $1 ORDER BY created_at DESC, id DESC;
