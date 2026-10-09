// Composition root: reads configuration, builds the adapters, wires them together and starts the
// server. Nothing imports this module.
import { loadConfig } from './config.ts';
import { identityService } from './application/identity.ts';
import { taskService } from './application/tasks.ts';
import { argon2PasswordHasher } from './adapters/security/password.ts';
import { createSql } from './adapters/persistence/client.ts';
import { taskRepository } from './adapters/persistence/task-repository.ts';
import { userRepository } from './adapters/persistence/user-repository.ts';
import { createWebApp } from './adapters/web/app.tsx';

const config = loadConfig();
const sql = createSql(config.databaseUrl);
const identity = identityService({ users: userRepository(sql), passwords: argon2PasswordHasher });
const tasks = taskService({ tasks: taskRepository(sql) });

// Development convenience account, registered through the normal use case and only when the
// server runs in development. An existing account, and its password, is left alone.
if (config.env === 'development') {
  const devUserEmail = 'dev@example.com';
  const devUserPassword = 'devdevdevdev';
  if ((await identity.register(devUserEmail, devUserPassword)).ok) {
    console.log(`Seeded development user ${devUserEmail} / ${devUserPassword}`);
  }
}

const app = createWebApp({
  identity,
  tasks,
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
