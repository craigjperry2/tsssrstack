-- A trigger increments session_version (revoking older sessions) and sets updated_at; RETURNING
-- reports the bumped version.
UPDATE app.users SET password_hash = $2
WHERE id = $1 RETURNING id, email_normalized, password_hash, session_version;
