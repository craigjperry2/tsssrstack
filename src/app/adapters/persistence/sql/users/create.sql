INSERT INTO app.users (email_normalized, password_hash) VALUES ($1, $2)
RETURNING id, email_normalized, password_hash, session_version;
