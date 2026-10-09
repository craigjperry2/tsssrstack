INSERT INTO app.tasks (user_id, title, description, due_date) VALUES ($1, $2, $3, $4::text::date);
