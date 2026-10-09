SELECT id, user_id, title, description, is_completed FROM app.tasks WHERE id = $1 AND user_id = $2;
