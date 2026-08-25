SELECT id, email_normalized, password_hash, session_version FROM app.users WHERE email_normalized = $1;
