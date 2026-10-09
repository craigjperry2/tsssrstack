import type { TransactionSql } from 'postgres';
import { createSql } from '../../src/app/adapters/persistence/client.ts';

// Repository contract and schema tests run against a real, migrated PostgreSQL when DATABASE_URL
// is available (CI provides one) and are reported as ignored otherwise. DATABASE_URL is the
// runtime login (a member of app_runtime), as for the application, not the schema owner.
const granted = Deno.permissions.querySync({ name: 'env', variable: 'DATABASE_URL' }).state ===
  'granted';
const databaseUrl = granted ? Deno.env.get('DATABASE_URL') : undefined;

class Rollback extends Error {}

// Runs fn in a transaction that is always rolled back, so tests leave no rows behind.
export function dbTest(name: string, fn: (db: TransactionSql) => Promise<void>) {
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

// A string with the shape of an Argon2id PHC hash, which is all the app.password_hash domain
// checks. label must use base64url characters only. Not verifiable as a real password.
export const fakeArgon2Hash = (label: string) => `$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$${label}`;
