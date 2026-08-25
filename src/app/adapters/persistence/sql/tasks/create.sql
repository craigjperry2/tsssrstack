INSERT INTO app.tasks (user_id, title, description) VALUES ($1, $2, NULLIF($3, ''));
