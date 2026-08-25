DELETE FROM app.tasks WHERE id = $1 AND user_id = $2 RETURNING id;
