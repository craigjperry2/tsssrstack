// Composition root: reads configuration, builds the adapters, wires them together and starts the
// server. Nothing imports this module.
import { loadConfig } from './config.ts';
import { hashPassword, verifyPassword } from './adapters/security/password.ts';
import { createSql } from './adapters/persistence/client.ts';
import { tasks, users } from './adapters/persistence/repositories.ts';
import { devUserEmail, devUserPassword, seedDevUser } from './adapters/persistence/seed.ts';
import { createWebApp } from './adapters/web/app.tsx';

const config = loadConfig();
const sql = createSql(config);
// Development convenience account, only seeded when the server runs in development;
// test and production environments never touch this path.
if (config.env === 'development') {
  const seeded = await seedDevUser(sql);
  if (seeded) {
    console.log(`Seeded development user ${devUserEmail} / ${devUserPassword}`);
  }
}
const app = createWebApp({
  users: users(sql),
  tasks: tasks(sql),
  passwords: { hash: hashPassword, verify: verifyPassword },
  session: { secret: config.sessionSecret, secure: config.env === 'production' },
  appOrigin: config.appOrigin,
  ready: async () => {
    try {
      await sql`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  },
});

Deno.serve({ hostname: config.host, port: config.port }, app.fetch);
