// The architecture lint plugin must catch violations; `pnpm lint` applies it to the real code.
// Each case lists the rules that must report it, once per entry; every other rule must stay quiet.
import { describe, it } from 'node:test';
import type { Plugin } from '@oxlint/plugins';
import { RuleTester } from 'oxlint/plugins-dev';
import plugin, { architecturePlugin } from '../tools/architecture_lint.ts';

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester();

const layers = 'layer-dependencies';
const purity = 'pure-core';
const processAccess = 'process-access';
type Case = [file: string, source: string, rules: string[]];

function expectLint(title: string, cases: Case[], target: Plugin = plugin) {
  describe(title, () => {
    for (const [name, rule] of Object.entries(target.rules)) {
      tester.run(name, rule, {
        valid: cases
          .filter(([, , rules]) => !rules.includes(name))
          .map(([filename, code]) => ({ filename, code })),
        invalid: cases
          .filter(([, , rules]) => rules.includes(name))
          .map(([filename, code, rules]) => ({
            filename,
            code,
            errors: rules.filter((r) => r === name).length,
          })),
      });
    }
  });
}

const web = 'src/app/adapters/web/app.tsx';
const domain = 'src/app/domain/task.ts';

expectLint('each layer may import only the layers inside it', [
  [domain, "import { ok } from './shared.ts';", []],
  [domain, "import { taskService } from '../application/tasks.ts';", [layers]],
  ['src/app/application/tasks.ts', "import { ok } from '../domain/shared.ts';", []],
  ['src/app/application/tasks.ts', "import { x } from '../adapters/web/app.tsx';", [layers]],
  [web, "import { t } from '../../application/tasks.ts';", []],
  [web, "import { s } from './session.ts';", []],
  [web, "import { Db } from '../persistence/client.ts';", [layers]],
  ['src/app/adapters/persistence/client.ts', "import { c } from '../../config.ts';", [layers]],
  ['src/app/main.tsx', "import { createWebApp } from './adapters/web/app.tsx';", []],
]);

const view = 'src/app/adapters/web/views/tasks.tsx';
expectLint('type-only, re-exported and dynamic dependencies count too', [
  [view, "import type { Row } from '../../persistence/rows.ts';", [layers]],
  [view, "export * from '../../persistence/rows.ts';", [layers]],
  [view, "export { Row } from '../../persistence/rows.ts';", [layers]],
  [view, "type Row = import('../../persistence/rows.ts').Row;", [layers]],
  [view, "await import('../../persistence/rows.ts');", [layers]],
  ['src/app/application/x.ts', 'await import(name);', [layers]],
]);

expectLint('only adapters and the composition root may use packages', [
  [domain, "import { Hono } from 'hono';", [layers]],
  ['src/app/application/x.ts', "import type { Sql } from 'postgres';", [layers]],
  [web, "import { Hono } from 'hono';", []],
]);

expectLint('absolute paths and file: URLs are classified like relative imports', [
  ['/repo/' + web, "import { s } from '/repo/src/app/adapters/web/session.ts';", []],
  ['/repo/' + web, "import { t } from '/repo/src/app/application/tasks.ts';", []],
  ['/repo/' + web, "import { Db } from '/repo/src/app/adapters/persistence/client.ts';", [layers]],
  [
    '/repo/' + web,
    "import { Db } from 'file:///repo/src/app/adapters/persistence/client.ts';",
    [layers],
  ],
  ['/repo/' + web, "import { ok } from 'file:///repo/src/app/domain/shared.ts';", []],
  ['/repo/' + web, "import { x } from '/repo/tools/architecture_lint.ts';", [layers]],
  [domain, "import { t } from '/repo/src/app/application/tasks.ts';", [layers]],
  [domain, "import { t } from 'file:///repo/src/app/domain/shared.ts';", []],
]);

expectLint('node: built-ins and dependencies are external; Deno and remote specifiers are not', [
  [web, "import postgres from 'postgres';", []],
  [web, "import { Buffer } from 'node:buffer';", []],
  [domain, "import postgres from 'postgres';", [layers]],
  ['src/app/application/x.ts', "import { Buffer } from 'node:buffer';", [layers]],
  [web, "import postgres from 'npm:postgres@3';", [layers]],
  [web, "import { Hono } from 'jsr:@hono/hono@4';", [layers]],
  [web, "import x from 'https://esm.sh/x';", [layers]],
  ['src/app/main.tsx', "import x from 'http://example.test/x.ts';", [layers]],
]);

expectLint(
  'bare specifiers must name a package.json dependency',
  [
    [web, "import { Hono } from 'hono';", []],
    [web, "import { jsx } from 'hono/jsx';", []],
    [web, "import 'bulma/css/bulma.min.css';", []],
    [web, "import { serveStatic } from '@hono/node-server/serve-static';", []],
    [web, "import x from '@hono/other';", [layers]],
    [web, "import x from 'honox';", [layers]],
    [web, "import x from 'left-pad';", [layers]],
    ['src/app/main.tsx', "import x from 'left-pad';", [layers]],
    [web, "import { readFileSync } from 'fs';", [layers]],
    [web, "import { Db } from '#persistence/client.ts';", [layers]],
    [domain, "import { Hono } from 'hono';", [layers]],
  ],
  architecturePlugin(['hono', 'bulma', '@hono/node-server']),
);

// The default export reads the repository's own package.json.
expectLint("the default plugin uses this repository's dependencies", [
  [web, "import { jsx } from 'hono/jsx';", []],
  [web, "import x from 'not-in-package-json';", [layers]],
]);

expectLint('files must live in a known layer; tests and tools are not governed', [
  ['src/app/utils/strings.ts', 'export const x = 1;', [layers]],
  ['src/app/helpers.ts', 'export const x = 1;', [layers]],
  ['src/app/config.ts', "import { x } from './adapters/web/app.tsx';", []],
  ['src/app/main.tsx', 'export const x = 1;', []],
  ['tests/web/app_test.ts', "import { x } from '../../src/app/main.tsx';", []],
]);

expectLint('the core is free of JSX, ambient I/O, time and randomness', [
  ['src/app/domain/task.tsx', 'const view = <p>hi</p>;', [purity]],
  [domain, 'const now = Date.now();', [purity]],
  [domain, 'const now = new Date();', [purity]],
  [domain, 'const n = Math.random();', [purity]],
  [domain, "await fetch('https://example.test');", [purity]],
  [domain, 'const epoch = new Date(0);', []],
  ['src/app/adapters/web/session.ts', 'const now = Date.now();', []],
]);

expectLint(
  'the core may not reach the ambient globals by any spelling',
  [
    'globalThis.fetch(url);',
    "Date['now']();",
    "Math['random']();",
    'Math[key]();',
    'const c = crypto; c.getRandomValues(bytes);',
    'const { now } = Date;',
    'const D = Date; D.now();',
    'const f = fetch;',
    'crypto.randomUUID();',
    'window.location.href;',
    'self.postMessage(1);',
    'Date.UTC(2026, 0, 1);',
    '(Date as unknown as { now(): number }).now();',
    // A parameter named fetch in one function does not excuse the global in another.
    'function a(fetch: () => void) { fetch(); } function b() { fetch(); }',
  ].map((source): Case => [domain, source, [purity]]),
);

// A configured global sits in the global scope without a declaration; it is still the global.
describe('globals declared in the lint configuration are still globals', () => {
  tester.run(purity, plugin.rules[purity], {
    valid: [],
    invalid: [
      {
        filename: domain,
        code: 'fetch(url);',
        languageOptions: { globals: { fetch: 'readonly' } },
        errors: 1,
      },
    ],
  });
});

expectLint(
  'the core may use local bindings, types and the deterministic parts of Date and Math',
  [
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
    'const deps = { fetch: 1, process: 2 }; deps.fetch; deps.process; deps.Date.now();',
  ].map((source): Case => [domain, source, []]),
);

expectLint('only config.ts and the migration runner may use process', [
  ['src/app/config.ts', 'const url = process.env.DATABASE_URL;', []],
  [
    'src/app/adapters/persistence/migrate.ts',
    "import process from 'node:process'; const url = process.env.MIGRATION_DATABASE_URL;",
    [],
  ],
  [
    'src/app/adapters/persistence/client.ts',
    'const url = process.env.DATABASE_URL;',
    [processAccess],
  ],
  [web, "import { env } from 'node:process';", [processAccess]],
  [web, "import process from 'process';", [layers, processAccess]],
  ['src/app/main.tsx', 'process.exit(1);', [processAccess]],
  [domain, 'const env = process.env;', [processAccess]],
  [web, 'function run(process: { env: object }) { return process.env; }', []],
  ['tests/web/app_test.ts', 'const url = process.env.DATABASE_URL;', []],
]);
