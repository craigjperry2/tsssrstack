export type Config = Readonly<{
  env: 'development' | 'test' | 'production';
  appOrigin: string;
  databaseUrl: string;
  sessionSecret: string;
  host: string;
  port: number;
  logLevel: string;
}>;

function required(name: string, errors: string[]): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) errors.push(`${name} is required`);
  return value ?? '';
}

export function loadConfig(): Config {
  const errors: string[] = [];
  const env = (Deno.env.get('ENV') ?? 'development') as Config['env'];
  if (!['development', 'test', 'production'].includes(env)) {
    errors.push('ENV must be development, test, or production');
  }
  const appOrigin = required('APP_ORIGIN', errors);
  try {
    new URL(appOrigin);
  } catch {
    errors.push('APP_ORIGIN must be an absolute URL');
  }
  const databaseUrl = required('DATABASE_URL', errors);
  const sessionSecret = required('SESSION_SECRET', errors);
  if (new TextEncoder().encode(sessionSecret).byteLength < 32) {
    errors.push('SESSION_SECRET must be at least 32 bytes');
  }
  const port = Number(Deno.env.get('PORT') ?? '8000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT must be a valid TCP port');
  }
  if (errors.length) throw new Error(`Invalid configuration:\n- ${errors.join('\n- ')}`);
  return {
    env,
    appOrigin,
    databaseUrl,
    sessionSecret,
    host: Deno.env.get('HOST') ?? '0.0.0.0',
    port,
    logLevel: Deno.env.get('LOG_LEVEL') ?? 'info',
  };
}
