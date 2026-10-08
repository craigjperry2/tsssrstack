import postgres from 'postgres';
const url = Deno.env.get('DATABASE_URL');
if (!url) throw new Error('DATABASE_URL is required');
const sql = postgres(url, { max: 1 });
try {
  await sql`SELECT pg_advisory_lock(829225924001)`;
  await sql`CREATE SCHEMA IF NOT EXISTS app`;
  await sql`CREATE TABLE IF NOT EXISTS app.schema_migrations (version integer PRIMARY KEY, filename text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
  const files = [...Deno.readDirSync('migrations')].filter((f) =>
    f.isFile && /^\d{3}_.+\.sql$/u.test(f.name)
  ).sort((a, b) => a.name.localeCompare(b.name));
  for (const file of files) {
    const version = Number(file.name.slice(0, 3));
    const content = await Deno.readTextFile(`migrations/${file.name}`);
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
