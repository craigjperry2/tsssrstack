SELECT id, user_id, title, description, is_completed FROM app.tasks WHERE user_id = $1 ORDER BY created_at DESC, id DESC;
