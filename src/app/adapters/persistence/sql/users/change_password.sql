UPDATE app.users SET password_hash = $2, session_version = session_version + 1, updated_at = now()
WHERE id = $1 RETURNING id, email_normalized, password_hash, session_version;
