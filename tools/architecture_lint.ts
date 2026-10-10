// An oxlint JS plugin that enforces the dependency rule in ARCHITECTURE.md, so a misplaced import
// fails `pnpm lint` (and CI) instead of quietly eroding the layers.
//
//   domain            → domain
//   application       → application, domain
//   adapters/<name>   → the same adapter, application, domain, external packages
//   composition root  → anything (src/app/main.tsx and src/app/config.ts; nothing imports them)
//
// Only files under src/app/ are governed. Relative paths, absolute paths and file: URLs are
// classified by the layer they reach. node: built-ins and bare specifiers naming a package.json
// dependency are external packages. Remote URLs and any other bare specifier are reported.
import { readFileSync } from 'node:fs';
import type { Context, ESTree, Plugin, Scope } from '@oxlint/plugins';

type Layer = 'domain' | 'application' | 'composition' | `adapters/${string}`;
type Node = ESTree.Node;
type Identifier = Extract<Node, { type: 'Identifier' }>;

const compositionFiles = ['main.tsx', 'config.ts'];

// The layer of a file under src/app/, null for an unrecognised location there, and undefined
// for files outside src/app/ (tests, tools).
function layerOf(path: string): Layer | null | undefined {
  const normalized = `/${path}`;
  const root = normalized.lastIndexOf('/src/app/');
  if (root < 0) return undefined;
  const parts = normalized.slice(root + '/src/app/'.length).split('/');
  if (parts.length === 1) return compositionFiles.includes(parts[0]) ? 'composition' : null;
  if (parts[0] === 'domain' || parts[0] === 'application') return parts[0];
  if (parts[0] === 'adapters' && parts.length > 2) return `adapters/${parts[1]}`;
  return null;
}

function allowed(from: Layer, to: Layer): boolean {
  if (from === 'composition') return true;
  if (to === 'composition') return false;
  if (to === 'domain') return true;
  if (to === 'application') return from !== 'domain';
  return from === to;
}

const pure = (layer: Layer | null | undefined) => layer === 'domain' || layer === 'application';

const isRemote = (specifier: string) => /^https?:/iu.test(specifier);
const isLocalPath = (specifier: string) =>
  specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:');
// The package a bare specifier names: `hono/jsx` → `hono`, `@hono/node-server/x` → `@hono/node-server`.
const packageName = (specifier: string) =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');

type Target =
  | { kind: 'external' }
  | { kind: 'local'; path: string }
  | { kind: 'unresolved'; reason: string };

// Resolves a specifier the way Node would, far enough to know which layer it reaches.
function resolve(specifier: string, importer: URL, dependencies: ReadonlySet<string>): Target {
  if (specifier.startsWith('node:')) return { kind: 'external' };
  if (isRemote(specifier)) return { kind: 'unresolved', reason: 'remote imports are not allowed' };
  if (isLocalPath(specifier)) {
    return { kind: 'local', path: decodeURIComponent(new URL(specifier, importer).pathname) };
  }
  if (dependencies.has(packageName(specifier))) return { kind: 'external' };
  return { kind: 'unresolved', reason: 'it is not a dependency in package.json' };
}

// Ambient globals that perform I/O or reach the outside world; any value reference is banned.
const bannedGlobals = ['fetch', 'crypto', 'globalThis', 'window', 'self'];

// Parents in which an identifier names a type, not a value.
const typeContexts = new Set([
  'TSTypeAnnotation',
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
  'TSTypeParameterDeclaration',
  'TSTypeParameterInstantiation',
  'TSTypeReference',
  'TSTypeQuery',
  'TSQualifiedName',
  'TSClassImplements',
  'TSInterfaceHeritage',
]);

function inTypePosition(node: Node): boolean {
  let child: Node = node;
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (typeContexts.has(parent.type)) return true;
    if (
      (parent.type === 'TSAsExpression' ||
        parent.type === 'TSSatisfiesExpression' ||
        parent.type === 'TSTypeAssertion') &&
      parent.typeAnnotation === child
    )
      return true;
  }
  return false;
}

// Whether an identifier refers to a variable, as opposed to naming a property, key, label or type.
function isValueReference(id: Identifier): boolean {
  const parent = id.parent;
  switch (parent.type) {
    case 'MemberExpression':
      return parent.computed || parent.property !== id;
    case 'Property':
    case 'MethodDefinition':
    case 'PropertyDefinition':
    case 'TSAbstractMethodDefinition':
    case 'TSAbstractPropertyDefinition':
    case 'TSPropertySignature':
    case 'TSMethodSignature':
      return parent.computed || parent.key !== id;
    case 'ExportSpecifier':
      return parent.local === id;
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
    case 'MetaProperty':
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'TSEnumMember':
    case 'TSModuleDeclaration':
      return false;
  }
  return !inTypePosition(id);
}

// A value reference to a global: no enclosing scope declares the name. (sourceCode's
// isGlobalReference is narrower: it ignores names that are not configured globals, like process.)
function isGlobalValue(context: Context, id: Identifier): boolean {
  if (!isValueReference(id)) return false;
  for (let scope: Scope | null = context.sourceCode.getScope(id); scope; scope = scope.upper) {
    const variable = scope.set.get(id.name);
    if (variable) return variable.defs.length === 0;
  }
  return true;
}

// Calls check with the specifier of every import, re-export, `import()` type and dynamic import;
// undefined for a dynamic import whose specifier is not a string literal.
function importVisitors(check: (node: Node, specifier: string | undefined) => void) {
  return {
    ImportDeclaration: (node: ESTree.ImportDeclaration) => check(node, node.source.value),
    ExportAllDeclaration: (node: ESTree.ExportAllDeclaration) => check(node, node.source.value),
    ExportNamedDeclaration(node: ESTree.ExportNamedDeclaration) {
      if (node.source) check(node, node.source.value);
    },
    TSImportType: (node: ESTree.TSImportType) => check(node, node.source.value),
    ImportExpression(node: ESTree.ImportExpression) {
      const source = node.source;
      const literal = source.type === 'Literal' && typeof source.value === 'string';
      check(node, literal ? source.value : undefined);
    },
  };
}

// The files that may read the environment: the configuration and the migration runner.
const processFiles = ['src/app/config.ts', 'src/app/adapters/persistence/migrate.ts'];

export function architecturePlugin(dependencies: Iterable<string>): Plugin {
  const packages = new Set(dependencies);
  return {
    meta: { name: 'architecture' },
    rules: {
      'layer-dependencies': {
        create(context) {
          const from = layerOf(context.filename);
          if (from === undefined) return {};
          const importer = new URL(context.filename.replace(/^\/*/u, ''), 'file:///');
          return {
            Program(node) {
              if (from === null) {
                context.report({
                  node,
                  message:
                    `Files under src/app/ belong in domain/, application/ or adapters/<name>/; ` +
                    `only ${compositionFiles.join(' and ')} sit at its root.`,
                });
              }
            },
            ...importVisitors((node, specifier) => {
              if (from === null) return;
              if (specifier === undefined) {
                context.report({ node, message: 'Dynamic imports must use a literal specifier.' });
                return;
              }
              const target = resolve(specifier, importer, packages);
              if (target.kind === 'unresolved') {
                context.report({
                  node,
                  message:
                    `Cannot classify '${specifier}': ${target.reason}. Use a relative ` +
                    'path, a node: built-in, or a package listed in package.json.',
                });
              } else if (target.kind === 'external') {
                if (pure(from)) {
                  context.report({
                    node,
                    message: `${from} must not depend on '${specifier}'; only adapters use packages.`,
                  });
                }
              } else {
                const to = layerOf(target.path);
                if (!to || !allowed(from, to)) {
                  context.report({
                    node,
                    message:
                      `${from} must not depend on ${to ?? target.path} ('${specifier}'). ` +
                      'See the dependency rule in ARCHITECTURE.md.',
                  });
                }
              }
            }),
          };
        },
      },

      // The core is deterministic: time, randomness and I/O arrive through ports, and markup is
      // an adapter concern. The rule checks references to the ambient globals, not spellings:
      //
      //   fetch, crypto, globalThis, window, self   no value reference at all
      //   Date   only `new Date(<at least one argument>)`, or in a type
      //   Math   only a member access other than `random` (by dot or string literal)
      //
      // A name bound in an enclosing scope (an import, a parameter, a variable, ...) is not the
      // global, so it is allowed.
      'pure-core': {
        create(context) {
          if (!pure(layerOf(context.filename))) return {};
          const report = (node: Node, what: string) =>
            context.report({
              node,
              message:
                `${what} is not allowed in the domain or application layers. ` +
                'Inject it through a port, such as Clock.',
            });
          return {
            JSXElement: (node) => report(node, 'JSX'),
            JSXFragment: (node) => report(node, 'JSX'),
            Identifier(id) {
              if (!['Date', 'Math', ...bannedGlobals].includes(id.name)) return;
              if (!isGlobalValue(context, id)) return;
              const parent = id.parent;
              if (bannedGlobals.includes(id.name)) {
                report(id, id.name);
              } else if (id.name === 'Date') {
                const constructed =
                  parent.type === 'NewExpression' &&
                  parent.callee === id &&
                  parent.arguments.length > 0;
                if (!constructed) report(id, 'Date, other than new Date(value),');
              } else {
                const member = parent.type === 'MemberExpression' && parent.object === id;
                const property = !member
                  ? undefined
                  : !parent.computed && parent.property.type === 'Identifier'
                    ? parent.property.name
                    : parent.computed &&
                        parent.property.type === 'Literal' &&
                        typeof parent.property.value === 'string'
                      ? parent.property.value
                      : undefined;
                if (property === undefined || property === 'random') report(id, 'Math.random()');
              }
            },
          };
        },
      },

      // Node cannot limit which environment variables the process may read, as Deno's
      // --allow-env did, so the application code is held to it instead: only processFiles may
      // use `process`. This guards against accidental use, not against a malicious dependency.
      'process-access': {
        create(context) {
          const file = context.filename.replaceAll('\\', '/');
          if (layerOf(file) === undefined || processFiles.some((f) => file.endsWith(f))) {
            return {};
          }
          const report = (node: Node) =>
            context.report({
              node,
              message:
                `Only ${processFiles.join(' and ')} may use process; read configuration ` +
                'in config.ts and pass it in.',
            });
          return {
            ...importVisitors((node, specifier) => {
              if (specifier === 'node:process' || specifier === 'process') report(node);
            }),
            Identifier(id) {
              if (id.name === 'process' && isGlobalValue(context, id)) report(id);
            },
          };
        },
      },
    },
  };
}

// The repository's own dependencies, read from package.json in the working directory, the
// repository root, where pnpm runs oxlint and the tests.
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
export default architecturePlugin([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
]);
