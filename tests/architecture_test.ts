// The architecture lint plugin must catch violations; `deno lint` applies it to the real code.
import plugin, { architecturePlugin } from '../tools/architecture_lint.ts';
import { assertEquals } from './support/assert.ts';

const lint = (file: string, source: string) =>
  Deno.lint.runPlugin(plugin, file, source).map((diagnostic) => diagnostic.id);
const layers = 'architecture/layer-dependencies';
const purity = 'architecture/pure-core';

Deno.test('each layer may import only the layers inside it', () => {
  const cases: [string, string, string[]][] = [
    ['src/app/domain/task.ts', "import { ok } from './shared.ts';", []],
    ['src/app/domain/task.ts', "import { taskService } from '../application/tasks.ts';", [layers]],
    ['src/app/application/tasks.ts', "import { ok } from '../domain/shared.ts';", []],
    ['src/app/application/tasks.ts', "import { x } from '../adapters/web/app.tsx';", [layers]],
    ['src/app/adapters/web/app.tsx', "import { t } from '../../application/tasks.ts';", []],
    ['src/app/adapters/web/app.tsx', "import { s } from './session.ts';", []],
    ['src/app/adapters/web/app.tsx', "import { Db } from '../persistence/client.ts';", [layers]],
    ['src/app/adapters/persistence/client.ts', "import { c } from '../../config.ts';", [layers]],
    ['src/app/main.tsx', "import { createWebApp } from './adapters/web/app.tsx';", []],
  ];
  for (const [file, source, expected] of cases) {
    assertEquals([file, source, lint(file, source)], [file, source, expected]);
  }
});

Deno.test('type-only, re-exported and dynamic dependencies count too', () => {
  const web = 'src/app/adapters/web/views/tasks.tsx';
  assertEquals(lint(web, "import type { Row } from '../../persistence/rows.ts';"), [layers]);
  assertEquals(lint(web, "export * from '../../persistence/rows.ts';"), [layers]);
  assertEquals(lint(web, "export { Row } from '../../persistence/rows.ts';"), [layers]);
  assertEquals(lint(web, "type Row = import('../../persistence/rows.ts').Row;"), [layers]);
  assertEquals(lint(web, "await import('../../persistence/rows.ts');"), [layers]);
  assertEquals(lint('src/app/application/x.ts', 'await import(name);'), [layers]);
});

Deno.test('only adapters and the composition root may use packages', () => {
  assertEquals(lint('src/app/domain/task.ts', "import { Hono } from 'hono';"), [layers]);
  assertEquals(lint('src/app/application/x.ts', "import type { Sql } from 'postgres';"), [layers]);
  assertEquals(lint('src/app/adapters/web/app.tsx', "import { Hono } from 'hono';"), []);
});

Deno.test('absolute paths and file: URLs are classified like relative imports', () => {
  const web = '/repo/src/app/adapters/web/app.tsx';
  const cases: [string, string, string[]][] = [
    [web, "import { s } from '/repo/src/app/adapters/web/session.ts';", []],
    [web, "import { t } from '/repo/src/app/application/tasks.ts';", []],
    [web, "import { Db } from '/repo/src/app/adapters/persistence/client.ts';", [layers]],
    [web, "import { Db } from 'file:///repo/src/app/adapters/persistence/client.ts';", [layers]],
    [web, "import { ok } from 'file:///repo/src/app/domain/shared.ts';", []],
    [web, "import { x } from '/repo/tools/architecture_lint.ts';", [layers]],
    ['src/app/domain/task.ts', "import { t } from '/repo/src/app/application/tasks.ts';", [
      layers,
    ]],
    ['src/app/domain/task.ts', "import { t } from 'file:///repo/src/app/domain/shared.ts';", []],
  ];
  for (const [file, source, expected] of cases) {
    assertEquals([file, source, lint(file, source)], [file, source, expected]);
  }
});

Deno.test('npm:, jsr: and node: specifiers are external packages; remote URLs are rejected', () => {
  const web = 'src/app/adapters/web/app.tsx';
  assertEquals(lint(web, "import postgres from 'npm:postgres@3';"), []);
  assertEquals(lint(web, "import { Hono } from 'jsr:@hono/hono@4';"), []);
  assertEquals(lint(web, "import { Buffer } from 'node:buffer';"), []);
  assertEquals(lint('src/app/domain/task.ts', "import postgres from 'npm:postgres@3';"), [layers]);
  assertEquals(lint('src/app/application/x.ts', "import { Buffer } from 'node:buffer';"), [layers]);
  assertEquals(lint(web, "import x from 'https://esm.sh/x';"), [layers]);
  assertEquals(lint('src/app/main.tsx', "import x from 'http://example.test/x.ts';"), [layers]);
});

Deno.test('bare specifiers resolve through the import map', () => {
  const mapped = architecturePlugin({
    hono: 'jsr:@hono/hono@4',
    bulma: 'npm:bulma@1',
    '#persistence/': './src/app/adapters/persistence/',
    '#shared': './src/app/domain/shared.ts',
    cdn: 'https://cdn.example/x.js',
  }, new URL('file:///repo/deno.json'));
  const lintMapped = (file: string, source: string) =>
    Deno.lint.runPlugin(mapped, file, source).map((diagnostic) => diagnostic.id);
  const web = 'src/app/adapters/web/app.tsx';
  const persistence = 'src/app/adapters/persistence/task-repository.ts';
  const cases: [string, string, string[]][] = [
    [web, "import { Hono } from 'hono';", []],
    [web, "import { jsx } from 'hono/jsx';", []],
    [web, "import 'bulma/css/bulma.min.css';", []],
    [web, "import x from 'honox';", [layers]],
    [web, "import x from 'left-pad';", [layers]],
    ['src/app/main.tsx', "import x from 'left-pad';", [layers]],
    [web, "import x from 'cdn';", [layers]],
    [web, "import { Db } from '#persistence/client.ts';", [layers]],
    [persistence, "import { Db } from '#persistence/client.ts';", []],
    ['src/app/main.tsx', "import { Db } from '#persistence/client.ts';", []],
    ['src/app/domain/task.ts', "import { ok } from '#shared';", []],
    ['src/app/domain/task.ts', "import { Hono } from 'hono';", [layers]],
  ];
  for (const [file, source, expected] of cases) {
    assertEquals([file, source, lintMapped(file, source)], [file, source, expected]);
  }
  // The default export reads the repository's own deno.json.
  assertEquals(lint(web, "import { jsx } from 'hono/jsx';"), []);
  assertEquals(lint(web, "import x from 'not-in-deno-json';"), [layers]);
});

Deno.test('files must live in a known layer; tests and tools are not governed', () => {
  assertEquals(lint('src/app/utils/strings.ts', 'export const x = 1;'), [layers]);
  assertEquals(lint('src/app/helpers.ts', 'export const x = 1;'), [layers]);
  assertEquals(lint('src/app/config.ts', "import { x } from './adapters/web/app.tsx';"), []);
  assertEquals(lint('src/app/main.tsx', 'export const x = 1;'), []);
  assertEquals(lint('tests/web/app_test.ts', "import { x } from '../../src/app/main.tsx';"), []);
});

Deno.test('the core is free of JSX, ambient I/O, time and randomness', () => {
  const domain = 'src/app/domain/task.tsx';
  assertEquals(lint(domain, 'const view = <p>hi</p>;'), [purity]);
  assertEquals(lint(domain, 'const now = Date.now();'), [purity]);
  assertEquals(lint(domain, 'const now = new Date();'), [purity]);
  assertEquals(lint(domain, "const env = Deno.env.get('X');"), [purity]);
  assertEquals(lint(domain, 'const n = Math.random();'), [purity]);
  assertEquals(lint(domain, "await fetch('https://example.test');"), [purity]);
  assertEquals(lint(domain, 'const epoch = new Date(0);'), []);
  assertEquals(lint('src/app/adapters/web/session.ts', 'const now = Date.now();'), []);
});

Deno.test('the core may not reach the ambient globals by any spelling', () => {
  const domain = 'src/app/domain/task.ts';
  const forbidden = [
    'globalThis.fetch(url);',
    "Date['now']();",
    "Math['random']();",
    'Math[key]();',
    'const io = Deno; io.readTextFile(p);',
    'const { now } = Date;',
    'const D = Date; D.now();',
    'const f = fetch;',
    'crypto.randomUUID();',
    'window.location.href;',
    'self.postMessage(1);',
    'Date.UTC(2026, 0, 1);',
    '(Date as unknown as { now(): number }).now();',
  ];
  for (const source of forbidden) {
    assertEquals([source, lint(domain, source)], [source, [purity]]);
  }
});

Deno.test('the core may use local bindings, types and the deterministic parts of Date and Math', () => {
  const domain = 'src/app/domain/task.ts';
  const allowed = [
    'function load(fetch: () => Promise<string>) { return fetch(); }',
    'const load = async ({ fetch }: { fetch(): Promise<string> }) => await fetch();',
    "import { crypto } from './crypto.ts'; crypto.hash();",
    'const self = { name: 1 }; self.name;',
    'try { run(); } catch (window) { log(window); }',
    'const epoch = new Date(0);',
    "const d = new Date('2026-10-09');",
    'const f = (d: Date): typeof Date | Date => d;',
    'type Now = ReturnType<typeof Date.now>;',
    'const n = Math.max(1, 2) + Math.floor(1.5);',
    "const n = Math['floor'](1.5);",
    'const deps = { fetch: 1, Deno: 2 }; deps.fetch; deps.Date.now();',
  ];
  for (const source of allowed) {
    assertEquals([source, lint(domain, source)], [source, []]);
  }
});
