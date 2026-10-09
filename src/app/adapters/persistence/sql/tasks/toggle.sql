UPDATE app.tasks SET is_completed = NOT is_completed WHERE id = $1 AND user_id = $2 RETURNING id;
