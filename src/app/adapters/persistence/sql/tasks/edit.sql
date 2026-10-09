UPDATE app.tasks SET title = $3, description = $4, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING id;
