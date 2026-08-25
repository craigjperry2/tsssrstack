UPDATE app.tasks SET is_completed = NOT is_completed, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING id;
