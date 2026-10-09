// The architecture lint plugin must catch violations; `deno lint` applies it to the real code.
import plugin from '../tools/architecture_lint.ts';
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

Deno.test('files must live in a known layer; tests and tools are not governed', () => {
  assertEquals(lint('src/app/utils/strings.ts', 'export const x = 1;'), [layers]);
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
