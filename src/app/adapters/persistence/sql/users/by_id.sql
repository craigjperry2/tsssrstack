SELECT id, email_normalized, password_hash, session_version FROM app.users WHERE id = $1;
