-- DEVELOPMENT ONLY. Creates the login role the app and the tests connect as, with a well-known
-- password. Idempotent, and safe to run before or after the migrations: migration 003 grants
-- app_runtime its privileges and reuses the role if it already exists.
--
-- Used by .agents/setup, compose.yaml (/docker-entrypoint-initdb.d) and CI. In production an
-- operator creates their own login role with a real secret and runs: GRANT app_runtime TO <login>;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_web') THEN
    CREATE ROLE app_web LOGIN;
  END IF;
END
$$;

-- Re-asserted on every run, so a drifted role is repaired. INHERIT lets app_web use app_runtime's
-- privileges without SET ROLE.
ALTER ROLE app_web WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'app_web';
GRANT app_runtime TO app_web;
