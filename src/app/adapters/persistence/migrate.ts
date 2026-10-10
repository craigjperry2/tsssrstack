import { readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import postgres from 'postgres';
// Migrations run as the schema owner. The application itself connects with DATABASE_URL, as a
// login role limited to app_runtime's grants, and never sees this URL.
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
const sql = postgres(url, { max: 1 });
try {
  await sql`SELECT pg_advisory_lock(829225924001)`;
  await sql`CREATE SCHEMA IF NOT EXISTS app`;
  await sql`CREATE TABLE IF NOT EXISTS app.schema_migrations (version integer PRIMARY KEY, filename text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
  const files = readdirSync('migrations', { withFileTypes: true })
    .filter((f) => f.isFile() && /^\d{3}_.+\.sql$/u.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const file of files) {
    const version = Number(file.name.slice(0, 3));
    const content = readFileSync(`migrations/${file.name}`, 'utf8');
    const checksum = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))),
      (v) => v.toString(16).padStart(2, '0'),
    ).join('');
    const applied = await sql<
      { checksum: string }[]
    >`SELECT checksum FROM app.schema_migrations WHERE version = ${version}`;
    if (applied[0]) {
      if (applied[0].checksum !== checksum) {
        throw new Error(`Migration checksum changed: ${file.name}`);
      }
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.file(`migrations/${file.name}`);
      await tx`INSERT INTO app.schema_migrations ${tx({ version, filename: file.name, checksum })}`;
    });
  }
} finally {
  await sql`SELECT pg_advisory_unlock(829225924001)`.catch(() => undefined);
  await sql.end();
}
