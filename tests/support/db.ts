import { createSql, type Db } from '../../src/app/adapters/persistence/client.ts';

// Repository contract tests run against a real, migrated PostgreSQL when DATABASE_URL is
// available (CI provides one) and are reported as ignored otherwise.
const granted = Deno.permissions.querySync({ name: 'env', variable: 'DATABASE_URL' }).state ===
  'granted';
const databaseUrl = granted ? Deno.env.get('DATABASE_URL') : undefined;

class Rollback extends Error {}

// Runs fn in a transaction that is always rolled back, so tests leave no rows behind.
export function dbTest(name: string, fn: (db: Db) => Promise<void>) {
  Deno.test({
    name,
    ignore: !databaseUrl,
    async fn() {
      const sql = createSql(databaseUrl!);
      try {
        await sql.begin(async (tx) => {
          await fn(tx);
          throw new Rollback();
        });
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      } finally {
        await sql.end();
      }
    },
  });
}

export const uniqueEmail = (name: string) => `${name}-${crypto.randomUUID()}@example.test`;
