// Deterministic, worktree-aware development workflow coordinator. The Justfile delegates to it:
// run `just --list` rather than calling it directly. Node standard library only, so it runs before
// `pnpm install`, with Node's built-in type stripping (`node tools/dev.ts <command>`).
//
// Each Git worktree gets its own app port, its own database in the shared local PostgreSQL
// cluster, and its own state in the gitignored .run/ directory. Background processes are stopped
// only when their PID and start time still match what this worktree recorded.
import { spawn, spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const RUN_DIR = join(ROOT, '.run');
const STACK_FILE = join(RUN_DIR, 'stack.json');
const PROCESS_FILE = join(RUN_DIR, 'processes.json');
const APP_LOG = join(RUN_DIR, 'app.log');
const STANDARD_PORT = 8000;
const PORT_OVERRIDE = 'TSSSRSTACK_PORT';
// The app is the only background process. Its ps command line must contain this marker.
const APP_COMMAND = ['pnpm', 'dev'];
const APP_MARKER = APP_COMMAND.join(' ');
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const DB_NAME = /^[a-z_][a-z0-9_]{0,62}$/u;

class ToolError extends Error {}

type Stack = { root: string; port: number; database: string };
type ProcessRecord = { pid: number; started: string; command: string[]; log: string };
type Processes = { root: string; processes: Record<string, ProcessRecord> };
type Env = Record<string, string | undefined>;

const notice = (message: string) => console.log(`[tsssrstack] ${message}`);

function run(command: string[], options: SpawnSyncOptions & { capture?: boolean } = {}) {
  const { capture, ...rest } = options;
  const result = spawnSync(command[0], command.slice(1), {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    ...rest,
  });
  if (result.error) throw new ToolError(`could not run ${command[0]}: ${result.error.message}`);
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

// Runs a command and fails with its output when it exits non-zero.
function must(command: string[], options: SpawnSyncOptions & { capture?: boolean } = {}) {
  const result = run(command, options);
  if (result.status !== 0) {
    const output = `${result.stdout}${result.stderr}`.trim();
    throw new ToolError(
      `command failed with status ${result.status}: ${command.join(' ')}${output ? `\n${output}` : ''}`,
    );
  }
  return result.stdout.trim();
}

const git = (...args: string[]) => must(['git', ...args], { capture: true });

function readDotenv(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  if (!existsSync(path)) return values;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const at = line.indexOf('=');
    let value = line.slice(at + 1).trim();
    if (value.length >= 2 && value[0] === value.at(-1) && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    values[line.slice(0, at).trim()] = value;
  }
  return values;
}

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    throw new ToolError(`${path} is not valid JSON; remove it and retry.`);
  }
}

function writeJson(path: string, value: unknown) {
  mkdirSync(RUN_DIR, { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

// ---------------------------------------------------------------------------------------------
// Worktree identity, ports and the database name

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function primaryCheckout(): string {
  return realpathSync(dirname(git('rev-parse', '--path-format=absolute', '--git-common-dir')));
}

const isPrimary = () => primaryCheckout() === ROOT;

function portIsFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.listen({ port, host: '127.0.0.1', exclusive: true }, () => probe.close(() => done(true)));
  });
}

function overridePort(): number | undefined {
  const raw = process.env[PORT_OVERRIDE];
  if (raw === undefined || raw === '') return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new ToolError(`${PORT_OVERRIDE} must be an integer between 1024 and 65535.`);
  }
  return port;
}

// The standard port in the primary checkout, otherwise one derived from the worktree path.
function preferredPort(): number {
  const override = overridePort();
  if (override !== undefined) return override;
  if (isPrimary()) return STANDARD_PORT;
  return 20_000 + (parseInt(hash(ROOT).slice(0, 8), 16) % 2_000) * 10;
}

async function allocatePort(): Promise<number> {
  const preferred = preferredPort();
  if (await portIsFree(preferred)) return preferred;
  if (overridePort() !== undefined) {
    throw new ToolError(`${PORT_OVERRIDE}=${preferred} is busy; choose another port.`);
  }
  const start = parseInt(hash(ROOT).slice(8, 14), 16) % 10_000;
  for (let offset = 0; offset < 10_000; offset++) {
    const port = 40_000 + ((start + offset) % 10_000);
    if (await portIsFree(port)) {
      notice(`Preferred port ${preferred} is busy; selected fallback port ${port}.`);
      return port;
    }
  }
  throw new ToolError(`No free port found; set ${PORT_OVERRIDE} explicitly.`);
}

// The primary checkout uses the database named in .env; each worktree gets its own beside it.
function databaseName(): string {
  const base = decodeURIComponent(databaseUrl('DATABASE_URL').pathname.slice(1));
  const name = isPrimary() ? base : `${base}_${hash(ROOT).slice(0, 8)}`;
  if (!DB_NAME.test(name))
    throw new ToolError(`Unsupported database name ${JSON.stringify(name)}.`);
  return name;
}

function loadStack(): Stack | undefined {
  if (!existsSync(STACK_FILE)) return undefined;
  const stack = readJson<Partial<Stack>>(STACK_FILE);
  if (
    typeof stack.root !== 'string' ||
    typeof stack.port !== 'number' ||
    typeof stack.database !== 'string'
  ) {
    throw new ToolError(`${STACK_FILE} is incomplete; remove it and retry.`);
  }
  if (stack.root !== ROOT) {
    throw new ToolError(`${STACK_FILE} belongs to ${stack.root}, not this worktree (${ROOT}).`);
  }
  return stack as Stack;
}

async function ensureStack(): Promise<Stack> {
  const existing = loadStack();
  if (existing) return existing;
  const stack = { root: ROOT, port: await allocatePort(), database: databaseName() };
  writeJson(STACK_FILE, stack);
  return stack;
}

// Before starting the app, allocate again: the preferred port when it is free, else a fallback.
async function refreshPort(stack: Stack): Promise<Stack> {
  const port = await allocatePort();
  if (port === stack.port) return stack;
  const updated = { ...stack, port };
  writeJson(STACK_FILE, updated);
  return updated;
}

// ---------------------------------------------------------------------------------------------
// Environment

function localEnv(): Record<string, string> {
  return readDotenv(join(ROOT, '.env'));
}

function databaseUrl(key: 'DATABASE_URL' | 'MIGRATION_DATABASE_URL'): URL {
  const value = localEnv()[key] ?? process.env[key];
  if (!value) throw new ToolError(`${key} is not set; run \`just setup\` to create .env.`);
  try {
    return new URL(value);
  } catch {
    throw new ToolError(`${key} in .env is not a valid URL.`);
  }
}

function withDatabase(url: URL, database: string): string {
  const copy = new URL(url);
  copy.pathname = `/${database}`;
  return copy.toString();
}

const appUrl = (stack: Stack) => `http://127.0.0.1:${stack.port}`;

// The worktree's environment: the shell, then .env, then this worktree's port and database.
function stackEnv(stack: Stack): Env {
  const env: Env = { ...process.env, ...localEnv() };
  env.HOST = '127.0.0.1';
  env.PORT = String(stack.port);
  env.APP_ORIGIN = appUrl(stack);
  env.DATABASE_URL = withDatabase(databaseUrl('DATABASE_URL'), stack.database);
  if (env.MIGRATION_DATABASE_URL) {
    env.MIGRATION_DATABASE_URL = withDatabase(
      databaseUrl('MIGRATION_DATABASE_URL'),
      stack.database,
    );
  }
  env.TSSSRSTACK_ROOT = ROOT;
  return env;
}

// ---------------------------------------------------------------------------------------------
// Setup

function ensureDotenv() {
  const target = join(ROOT, '.env');
  if (existsSync(target)) return;
  const primaryEnv = join(primaryCheckout(), '.env');
  if (primaryEnv !== target && existsSync(primaryEnv)) {
    copyFileSync(primaryEnv, target);
    notice('Created .env from the primary checkout.');
    return;
  }
  const example = join(ROOT, '.env.example');
  if (!existsSync(example)) throw new ToolError('.env.example is missing.');
  const secret = randomBytes(32).toString('hex');
  writeFileSync(
    target,
    readFileSync(example, 'utf8').replace(/^SESSION_SECRET=.*$/mu, `SESSION_SECRET=${secret}`),
  );
  notice('Created .env from .env.example with a random SESSION_SECRET.');
}

function setup() {
  ensureDotenv();
  notice('Installing the locked dependency set.');
  must(['pnpm', 'install', '--frozen-lockfile']);
  notice('Development environment is ready.');
}

// ---------------------------------------------------------------------------------------------
// Database

// psql connection settings come from the environment so passwords stay out of process listings.
function pgEnv(url: URL, database: string): Env {
  return {
    ...process.env,
    PGHOST: url.hostname.replace(/^\[|\]$/gu, ''),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
    PGOPTIONS: '-c client_min_messages=warning',
  };
}

function postgresReady(): boolean {
  const url = databaseUrl('DATABASE_URL');
  return (
    run(['pg_isready', '-q', '-h', url.hostname, '-p', url.port || '5432'], { capture: true })
      .status === 0
  );
}

function requirePostgres() {
  if (postgresReady()) return;
  const url = databaseUrl('DATABASE_URL');
  throw new ToolError(
    `PostgreSQL is not accepting connections at ${url.hostname}:${url.port || '5432'}.\n` +
      'In an Amp orb: sudo systemctl start tsssrstack-postgres (.agents/resume does this).\n' +
      'Elsewhere: run `process-compose up -D postgres` in the primary checkout.',
  );
}

// Database administration only ever targets a loopback server, so a .env pointing at shared data
// cannot be dropped, recreated or given the development role passwords.
function ownerUrl(): URL {
  const url = databaseUrl('MIGRATION_DATABASE_URL');
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new ToolError(`Refusing to administer non-local PostgreSQL host ${url.hostname}.`);
  }
  return url;
}

function psql(database: string, sql: string): string {
  return must(['psql', '-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    capture: true,
    env: pgEnv(ownerUrl(), database),
  });
}

function databaseExists(name: string): boolean {
  if (!DB_NAME.test(name)) throw new ToolError(`Unsupported database name ${name}.`);
  return psql('postgres', `SELECT 1 FROM pg_database WHERE datname = '${name}'`) === '1';
}

// Creates this worktree's database when missing and the development runtime login (idempotent).
function ensureDatabase(stack: Stack) {
  requirePostgres();
  if (!databaseExists(stack.database)) {
    psql('postgres', `CREATE DATABASE "${stack.database}"`);
    notice(`Created database ${stack.database}.`);
  }
  must(['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', 'infra/postgres/dev-roles.sql'], {
    capture: true,
    env: pgEnv(ownerUrl(), stack.database),
  });
}

async function migrate(): Promise<Stack> {
  const stack = await ensureStack();
  ensureDatabase(stack);
  notice(`Applying migrations to ${stack.database}.`);
  must(['pnpm', 'migrate'], { env: stackEnv(stack) });
  return stack;
}

function revision(message: string) {
  const slug = message
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  if (!slug) throw new ToolError('Pass a migration description, e.g. just db-revision "add tags".');
  const versions = readdirSync(join(ROOT, 'migrations'))
    .map((file) => /^(\d{3})_.+\.sql$/u.exec(file)?.[1])
    .filter((version) => version !== undefined)
    .map(Number);
  const next = String(Math.max(0, ...versions) + 1).padStart(3, '0');
  const file = join(ROOT, 'migrations', `${next}_${slug}.sql`);
  writeFileSync(
    file,
    `-- ${message.trim().replace(/\s+/gu, ' ')}
--
-- Applied migrations are checksummed and must never change, so finish this file before running
-- \`just db-migrate\`. Each new table states its app_runtime grants here; each domain value type
-- needs a matching database domain or constraint that accepts everything the TypeScript accepts.

-- Remove this guard once the migration is written. It stops a template from being applied.
DO $$ BEGIN RAISE EXCEPTION 'migrations/${next}_${slug}.sql is an unfinished template'; END $$;
`,
  );
  notice(`Created ${relative(ROOT, file)}. Write it, then run \`just db-migrate\`.`);
}

async function resetDatabase(confirmation: string) {
  const stack = await ensureStack();
  const expected = `reset-${stack.database}`;
  if (confirmation !== expected) {
    throw new ToolError(
      `This drops and recreates database ${stack.database}, deleting its data. ` +
        `Retry with \`just db-reset ${expected}\`.`,
    );
  }
  requirePostgres();
  ownerUrl();
  await down();
  psql('postgres', `DROP DATABASE IF EXISTS "${stack.database}" WITH (FORCE)`);
  notice(`Dropped database ${stack.database}.`);
  await up();
}

// ---------------------------------------------------------------------------------------------
// Background processes

function loadProcesses(): Processes {
  if (!existsSync(PROCESS_FILE)) return { root: ROOT, processes: {} };
  const payload = readJson<Partial<Processes>>(PROCESS_FILE);
  if (payload.root !== ROOT) throw new ToolError(`${PROCESS_FILE} belongs to another worktree.`);
  if (typeof payload.processes !== 'object' || payload.processes === null) {
    throw new ToolError(`${PROCESS_FILE} has an invalid process map.`);
  }
  return payload as Processes;
}

const saveProcesses = (payload: Processes) => writeJson(PROCESS_FILE, payload);

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const ps = (pid: number, field: string) =>
  run(['ps', '-p', String(pid), '-o', `${field}=`], { capture: true }).stdout.trim();

// Ours only when the PID is alive, started at the recorded time and still runs the app command.
function owned(record: ProcessRecord | undefined): boolean {
  if (!record || !Number.isInteger(record.pid) || !pidAlive(record.pid)) return false;
  if (!record.started || ps(record.pid, 'lstart') !== record.started) return false;
  return ps(record.pid, 'command').includes(APP_MARKER);
}

function tail(path: string, lines = 80): string {
  if (!existsSync(path)) return '(log file does not exist)';
  return readFileSync(path, 'utf8').split('\n').slice(-lines).join('\n').trim() || '(empty log)';
}

// Starts the app unless this worktree's app is already running. A recorded PID that is alive but
// not ours stops everything, before the port or the process record changes.
async function startApp(recorded: Stack): Promise<{ stack: Stack; message: string }> {
  const payload = loadProcesses();
  const existing = payload.processes.app;
  if (existing && pidAlive(existing.pid)) {
    if (!owned(existing)) {
      throw new ToolError(
        `PID ${existing.pid} recorded for app is a foreign process; refusing to replace or stop it.`,
      );
    }
    return { stack: recorded, message: `app already running as PID ${existing.pid}` };
  }
  delete payload.processes.app;
  saveProcesses(payload);
  const stack = await refreshPort(recorded);

  mkdirSync(RUN_DIR, { recursive: true });
  const log = openSync(APP_LOG, 'a');
  // detached: the app leads its own process group, so stopping it also stops tsc --watch.
  const child = spawn(APP_COMMAND[0], APP_COMMAND.slice(1), {
    cwd: ROOT,
    env: stackEnv(stack),
    detached: true,
    stdio: ['ignore', log, log],
  });
  closeSync(log);
  const pid = await new Promise<number>((done, fail) => {
    child.once('spawn', () => done(child.pid!));
    child.once('error', (error) => fail(new ToolError(`could not start app: ${error.message}`)));
  });
  child.unref();
  const started = ps(pid, 'lstart');
  if (!started) {
    process.kill(-pid, 'SIGTERM');
    throw new ToolError(`Could not record an ownership signature for app PID ${pid}.`);
  }
  payload.processes.app = {
    pid,
    started,
    command: APP_COMMAND,
    log: APP_LOG,
  };
  saveProcesses(payload);
  return { stack, message: `started app as PID ${pid}` };
}

async function stopApp(): Promise<string> {
  const payload = loadProcesses();
  const record = payload.processes.app;
  if (!record) return 'app is not recorded';
  if (!Number.isInteger(record.pid) || !pidAlive(record.pid)) {
    delete payload.processes.app;
    saveProcesses(payload);
    return `removed stale app PID ${record.pid}`;
  }
  if (!owned(record)) {
    throw new ToolError(
      `PID ${record.pid} recorded for app no longer matches; refusing to kill it.`,
    );
  }
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-record.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  signalGroup('SIGTERM');
  const deadline = Date.now() + 10_000;
  while (pidAlive(record.pid) && Date.now() < deadline) await sleep(100);
  if (pidAlive(record.pid)) signalGroup('SIGKILL');
  delete payload.processes.app;
  saveProcesses(payload);
  return `stopped app PID ${record.pid}`;
}

async function appReady(stack: Stack): Promise<boolean> {
  try {
    const response = await fetch(`${appUrl(stack)}/readyz`, { signal: AbortSignal.timeout(2000) });
    return response.status === 200;
  } catch {
    return false;
  }
}

// Waits for /readyz. node --watch keeps running after the server crashes, so a crash is detected
// from its "Failed running" line in the part of the log written since startup.
async function waitReady(stack: Stack, logOffset: number, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts++;
    if (!owned(loadProcesses().processes.app)) throw new ToolError('app exited during startup.');
    if (await appReady(stack)) {
      notice(`App became ready after ${attempts} attempt(s).`);
      return;
    }
    if (readFileSync(APP_LOG).subarray(logOffset).includes("Failed running '")) {
      throw new ToolError(
        'app crashed during startup; it restarts when a file changes, or stop it with `just down`.',
      );
    }
    await sleep(1000);
  }
  throw new ToolError(`App did not answer ${appUrl(stack)}/readyz within ${timeoutMs / 1000}s.`);
}

// ---------------------------------------------------------------------------------------------
// Commands

async function up() {
  setup();
  const migrated = await migrate();
  const logOffset = existsSync(APP_LOG) ? statSync(APP_LOG).size : 0;
  const { stack, message } = await startApp(migrated);
  notice(message);
  try {
    await waitReady(stack, logOffset);
  } catch (error) {
    if (!(error instanceof ToolError)) throw error;
    throw new ToolError(`${error.message}\n--- app log (${APP_LOG}) ---\n${tail(APP_LOG)}`);
  }
  urls(stack, false);
  notice('Use `just logs`, `just status` or `just diagnose` if needed.');
}

async function down() {
  notice(await stopApp());
}

function urls(stack: Stack, json: boolean) {
  const url = databaseUrl('DATABASE_URL');
  const values = {
    application: appUrl(stack),
    readyz: `${appUrl(stack)}/readyz`,
    port: stack.port,
    database: stack.database,
    postgres: `${url.hostname}:${url.port || '5432'}`,
  };
  if (json) {
    console.log(JSON.stringify(values, null, 2));
    return;
  }
  for (const [label, value] of Object.entries(values)) console.log(`${label}: ${value}`);
}

async function statusReport() {
  const stack = loadStack();
  const record = loadProcesses().processes.app;
  const running = owned(record);
  const ready = running && stack !== undefined && (await appReady(stack));
  return {
    root: ROOT,
    allocated: stack !== undefined,
    stack: stack ?? null,
    app: { running, ready, pid: running && record ? record.pid : null, log: APP_LOG },
    postgres: { ready: postgresReady() },
    healthy: running && ready,
  };
}

async function status(json: boolean): Promise<number> {
  const report = await statusReport();
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    if (report.stack) urls(report.stack, false);
    else notice('No stack allocated for this worktree yet; run `just up`.');
    const app = report.app;
    console.log(
      `app: ${app.running ? `running (PID ${app.pid})` : 'stopped'}, ${app.ready ? 'ready' : 'not ready'}`,
    );
    console.log(`postgres: ${report.postgres.ready ? 'accepting connections' : 'unavailable'}`);
  }
  return report.healthy ? 0 : 1;
}

async function diagnose() {
  await status(false);
  const stack = loadStack();
  if (stack) {
    const env = stackEnv(stack);
    console.log('--- environment (secrets omitted) ---');
    for (const key of ['ENV', 'HOST', 'PORT', 'APP_ORIGIN', 'LOG_LEVEL']) {
      console.log(`${key}=${env[key] ?? ''}`);
    }
    console.log(`database=${stack.database}`);
  }
  console.log(`--- app log (${APP_LOG}) ---\n${tail(APP_LOG)}`);
}

function logs(args: string[]): number {
  const { values } = parseArgs({
    args,
    options: {
      follow: { type: 'boolean', short: 'f', default: false },
      tail: { type: 'string', short: 'n', default: '100' },
    },
  });
  if (!/^\d+$/u.test(values.tail)) throw new ToolError('--tail must be a whole number.');
  if (!existsSync(APP_LOG)) throw new ToolError(`${APP_LOG} does not exist; run \`just up\`.`);
  return run(['tail', '-n', values.tail, ...(values.follow ? ['-F'] : []), APP_LOG]).status;
}

// Runs a command with this worktree's environment. `--set KEY=VALUE` adds or replaces a variable.
async function exec(args: string[], extra: Env = {}): Promise<number> {
  const separator = args.indexOf('--');
  if (separator === -1 || separator === args.length - 1) {
    throw new ToolError(
      `exec requires a command after \`--\`, e.g. just exec -- sh -c 'psql "$DATABASE_URL"'.`,
    );
  }
  const { values } = parseArgs({
    args: args.slice(0, separator),
    options: { set: { type: 'string', multiple: true, default: [] } },
  });
  const command = args.slice(separator + 1);
  const env = { ...stackEnv(await ensureStack()), ...extra };
  for (const pair of values.set) {
    const at = pair.indexOf('=');
    if (at < 1) throw new ToolError(`--set must be KEY=VALUE, got ${JSON.stringify(pair)}.`);
    env[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return run(command, { env }).status;
}

// The whole suite against this worktree's migrated database. Arguments are node --test options,
// passed through NODE_OPTIONS so the pnpm test script stays the single definition of the run.
async function test(args: string[]): Promise<number> {
  await migrate();
  const quoted = args.map((arg) => (/[\s"\\]/u.test(arg) ? JSON.stringify(arg) : arg));
  const nodeOptions = [process.env.NODE_OPTIONS ?? '', ...quoted].join(' ').trim();
  return exec(['--', 'pnpm', 'test'], { NODE_OPTIONS: nodeOptions || undefined });
}

function worktrees(): Record<string, string>[] {
  return git('worktree', 'list', '--porcelain')
    .split('\n\n')
    .map((block) =>
      Object.fromEntries(
        block.split('\n').map((line) => {
          const at = line.indexOf(' ');
          return at === -1 ? [line, ''] : [line.slice(0, at), line.slice(at + 1)];
        }),
      ),
    )
    .filter((record) => Object.keys(record).length > 0);
}

function worktreeClean(branch: string) {
  if (!branch) throw new ToolError('Pass the branch whose worktree should be removed.');
  if (['main', 'master'].includes(branch)) {
    throw new ToolError('The primary branch may never be removed by this command.');
  }
  const target = worktrees().find((entry) => entry.branch === `refs/heads/${branch}`);
  if (!target) throw new ToolError(`No worktree has branch ${JSON.stringify(branch)} checked out.`);
  const path = realpathSync(target.worktree);
  if (path === ROOT) throw new ToolError('Run worktree cleanup from a different checkout.');

  const pr = run(['gh', 'pr', 'view', branch, '--json', 'state,mergedAt,url'], { capture: true });
  if (pr.status !== 0) throw new ToolError(`Unable to verify the pull request:\n${pr.stderr}`);
  const { state, mergedAt, url } = JSON.parse(pr.stdout) as Record<string, string>;
  if (state !== 'MERGED' || !mergedAt) {
    throw new ToolError(`Refusing cleanup because ${url} is ${state}, not merged.`);
  }
  if (git('-C', path, 'status', '--porcelain')) {
    throw new ToolError(`Refusing cleanup because ${path} has local changes.`);
  }
  const processFile = join(path, '.run', 'processes.json');
  if (existsSync(processFile)) {
    const payload = readJson<Partial<Processes>>(processFile);
    for (const [name, record] of Object.entries(payload.processes ?? {})) {
      if (Number.isInteger(record.pid) && pidAlive(record.pid)) {
        throw new ToolError(
          `Refusing cleanup because ${name} PID ${record.pid} is still running. ` +
            `Run \`just -f ${join(path, 'Justfile')} down\` first.`,
        );
      }
    }
  }
  const stackFile = join(path, '.run', 'stack.json');
  const database = existsSync(stackFile) ? readJson<Partial<Stack>>(stackFile).database : undefined;

  must(['git', 'worktree', 'remove', path]);
  must(['git', 'branch', '-d', branch]);
  must(['git', 'worktree', 'prune']);
  notice(`Removed merged worktree ${path} and local branch ${branch}.`);
  notice('Remote branches are never deleted by this command.');
  if (database) notice(`Database ${database} remains in the local PostgreSQL cluster.`);
}

const USAGE = `usage: node tools/dev.ts <command> [arguments]
commands: setup, up, down, restart, status [--json], urls [--json], logs [-f] [-n N], diagnose,
          db-migrate, db-revision <message>, db-reset [token], test [node --test options],
          exec [--set KEY=VALUE]... -- <command...>, worktree-clean <branch>
Run \`just --list\` for the supported entry points.`;

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  const json = () =>
    parseArgs({ args, options: { json: { type: 'boolean' } } }).values.json ?? false;
  switch (command) {
    case 'setup':
      setup();
      return 0;
    case 'up':
      await up();
      return 0;
    case 'down':
      await down();
      return 0;
    case 'restart':
      await down();
      await up();
      return 0;
    case 'status':
      return status(json());
    case 'urls': {
      const asJson = json();
      urls(await ensureStack(), asJson);
      return 0;
    }
    case 'logs':
      return logs(args);
    case 'diagnose':
      await diagnose();
      return 0;
    case 'db-migrate':
      await migrate();
      return 0;
    case 'db-revision':
      revision(args.join(' '));
      return 0;
    case 'db-reset':
      await resetDatabase(args[0] ?? '');
      return 0;
    case 'test':
      return test(args);
    case 'exec':
      return exec(args);
    case 'worktree-clean':
      worktreeClean(args[0] ?? '');
      return 0;
    default:
      console.error(USAGE);
      return 2;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  const message =
    error instanceof ToolError || (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')
      ? (error as Error).message
      : String((error as Error).stack ?? error);
  console.error(`[tsssrstack] ERROR: ${message}`);
  process.exitCode = 1;
}
