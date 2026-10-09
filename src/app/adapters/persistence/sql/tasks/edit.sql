UPDATE app.tasks SET title = $3, description = $4, due_date = $5::text::date WHERE id = $1 AND user_id = $2 RETURNING id;
