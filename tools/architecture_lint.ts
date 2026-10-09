// A deno lint plugin that enforces the dependency rule in ARCHITECTURE.md, so a misplaced import
// fails `deno lint` (and CI) instead of quietly eroding the layers.
//
//   domain            → domain
//   application       → application, domain
//   adapters/<name>   → the same adapter, application, domain, external packages
//   composition root  → anything (src/app/main.tsx and src/app/config.ts; nothing imports them)
//
// Only files under src/app/ are governed. Relative paths, absolute paths, file: URLs and bare
// specifiers mapped by deno.json "imports" to local paths are all classified by the layer they
// reach. npm:, jsr: and node: specifiers (directly or through the import map) are external
// packages. Remote URLs and unmapped bare specifiers are reported.
import denoConfig from '../deno.json' with { type: 'json' };

type Layer = 'domain' | 'application' | 'composition' | `adapters/${string}`;
type ImportMap = Readonly<Record<string, string>>;

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

const isExternal = (specifier: string) => /^(npm|jsr|node):/u.test(specifier);
const isRemote = (specifier: string) => /^https?:/iu.test(specifier);
const isLocalPath = (specifier: string) =>
  specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/') ||
  specifier.startsWith('file:');

type Target =
  | { kind: 'external' }
  | { kind: 'local'; path: string }
  | { kind: 'unresolved'; reason: string };

// Resolves a specifier the way Deno would, far enough to know which layer it reaches.
function resolve(specifier: string, importer: URL, imports: ImportMap, configUrl: URL): Target {
  if (isExternal(specifier)) return { kind: 'external' };
  if (isRemote(specifier)) return { kind: 'unresolved', reason: 'remote imports are not allowed' };
  if (isLocalPath(specifier) || specifier.startsWith('.')) {
    return { kind: 'local', path: decodeURIComponent(new URL(specifier, importer).pathname) };
  }
  // A key matches exactly, or as a `key/` subpath prefix (an explicit "key/" entry, or the
  // implicit subpaths Deno allows for npm: and jsr: packages). The longest key wins.
  const key = Object.keys(imports)
    .filter((key) => specifier === key || specifier.startsWith(key.endsWith('/') ? key : `${key}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (key === undefined) {
    return { kind: 'unresolved', reason: 'it is not mapped in deno.json "imports"' };
  }
  const mapped = imports[key] + specifier.slice(key.length);
  if (isExternal(mapped)) return { kind: 'external' };
  if (isLocalPath(mapped)) {
    return { kind: 'local', path: decodeURIComponent(new URL(mapped, configUrl).pathname) };
  }
  return { kind: 'unresolved', reason: `it maps to '${mapped}'` };
}

// Ambient globals that perform I/O or reach the outside world; any value reference is banned.
const bannedGlobals = ['Deno', 'fetch', 'crypto', 'globalThis', 'window', 'self'];

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

function inTypePosition(node: AnyNode): boolean {
  let child: AnyNode = node;
  for (let parent = parentOf(node); parent; child = parent, parent = parentOf(parent)) {
    if (typeContexts.has(parent.type)) return true;
    if (
      (parent.type === 'TSAsExpression' || parent.type === 'TSSatisfiesExpression' ||
        parent.type === 'TSTypeAssertion') && parent.typeAnnotation === child
    ) return true;
  }
  return false;
}

// TSParameterProperty (`constructor(private x)`) is missing from Deno.lint.Node.
type AnyNode = Deno.lint.Node | Deno.lint.TSParameterProperty;

const parentOf = (node: AnyNode): AnyNode | undefined => 'parent' in node ? node.parent : undefined;

// Whether an identifier refers to a variable, as opposed to naming a property, key, label or type.
function isValueReference(id: Deno.lint.Identifier): boolean {
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

function bindNames(pattern: AnyNode | null | undefined, names: Set<string>): void {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier':
      names.add(pattern.name);
      break;
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        bindNames(property.type === 'RestElement' ? property : property.value, names);
      }
      break;
    case 'ArrayPattern':
      for (const element of pattern.elements) bindNames(element, names);
      break;
    case 'RestElement':
      bindNames(pattern.argument, names);
      break;
    case 'AssignmentPattern':
      bindNames(pattern.left, names);
      break;
    case 'TSParameterProperty':
      bindNames(pattern.parameter, names);
      break;
  }
}

export function architecturePlugin(
  imports: ImportMap,
  configUrl: URL = new URL('../deno.json', import.meta.url),
): Deno.lint.Plugin {
  return {
    name: 'architecture',
    rules: {
      'layer-dependencies': {
        create(context) {
          const from = layerOf(context.filename);
          if (from === undefined) return {};
          const importer = new URL(context.filename.replace(/^\/*/u, ''), 'file:///');
          const check = (node: Deno.lint.Node, specifier: string) => {
            if (from === null) return;
            const target = resolve(specifier, importer, imports, configUrl);
            if (target.kind === 'unresolved') {
              context.report({
                node,
                message: `Cannot classify '${specifier}': ${target.reason}.`,
                hint: 'Use a relative path, or a package mapped to npm: or jsr: in deno.json.',
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
                  message: `${from} must not depend on ${to ?? target.path} ('${specifier}').`,
                  hint: 'See the dependency rule in ARCHITECTURE.md.',
                });
              }
            }
          };
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
            ImportDeclaration: (node) => check(node, node.source.value),
            ExportAllDeclaration: (node) => check(node, node.source.value),
            ExportNamedDeclaration(node) {
              if (node.source) check(node, node.source.value);
            },
            TSImportType(node) {
              const argument = node.argument;
              if (
                argument.type === 'TSLiteralType' && argument.literal.type === 'Literal' &&
                typeof argument.literal.value === 'string'
              ) check(node, argument.literal.value);
            },
            ImportExpression(node) {
              if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
                check(node, node.source.value);
              } else {
                context.report({ node, message: 'Dynamic imports must use a literal specifier.' });
              }
            },
          };
        },
      },

      // The core is deterministic: time, randomness and I/O arrive through ports, and markup is
      // an adapter concern. The rule checks references to the ambient globals, not spellings:
      //
      //   Deno, fetch, crypto, globalThis, window, self   no value reference at all
      //   Date   only `new Date(<at least one argument>)`, or in a type
      //   Math   only a member access other than `random` (by dot or string literal)
      //
      // Deno's lint plugin API has no scope analysis, so a name counts as locally bound when the
      // file declares it anywhere: an import, a parameter, a variable, a function or class name,
      // or a catch clause. That is coarser than real scoping: a parameter named `fetch` in one
      // function also excuses a global `fetch` used in another function of the same file.
      'pure-core': {
        create(context) {
          if (!pure(layerOf(context.filename))) return {};
          const report = (node: Deno.lint.Node, what: string) =>
            context.report({
              node,
              message: `${what} is not allowed in the domain or application layers.`,
              hint: 'Inject it through a port, such as Clock.',
            });
          const bound = new Set<string>();
          const references: Deno.lint.Identifier[] = [];
          const bindFunction = (
            node: {
              id: Deno.lint.Identifier | null;
              params: Deno.lint.Parameter[];
            },
          ) => {
            bindNames(node.id, bound);
            for (const param of node.params) bindNames(param, bound);
          };
          const checkReference = (id: Deno.lint.Identifier) => {
            const parent = id.parent;
            if (bannedGlobals.includes(id.name)) {
              report(id, id.name);
            } else if (id.name === 'Date') {
              const constructed = parent.type === 'NewExpression' && parent.callee === id &&
                parent.arguments.length > 0;
              if (!constructed) report(id, 'Date, other than new Date(value),');
            } else if (id.name === 'Math') {
              const member = parent.type === 'MemberExpression' && parent.object === id;
              const property = !member
                ? undefined
                : !parent.computed && parent.property.type === 'Identifier'
                ? parent.property.name
                : parent.computed && parent.property.type === 'Literal' &&
                    typeof parent.property.value === 'string'
                ? parent.property.value
                : undefined;
              if (property === undefined || property === 'random') report(id, 'Math.random()');
            }
          };
          return {
            JSXElement: (node) => report(node, 'JSX'),
            JSXFragment: (node) => report(node, 'JSX'),
            Identifier(node) {
              if (
                (bannedGlobals.includes(node.name) || node.name === 'Date' ||
                  node.name === 'Math') && isValueReference(node)
              ) references.push(node);
            },
            VariableDeclarator: (node) => bindNames(node.id, bound),
            FunctionDeclaration: bindFunction,
            FunctionExpression: bindFunction,
            ArrowFunctionExpression: bindFunction,
            TSDeclareFunction: bindFunction,
            TSEmptyBodyFunctionExpression: bindFunction,
            ClassDeclaration: (node) => bindNames(node.id, bound),
            ClassExpression: (node) => bindNames(node.id, bound),
            CatchClause: (node) => bindNames(node.param, bound),
            ImportSpecifier: (node) => bindNames(node.local, bound),
            ImportDefaultSpecifier: (node) => bindNames(node.local, bound),
            ImportNamespaceSpecifier: (node) => bindNames(node.local, bound),
            'Program:exit'() {
              for (const id of references) if (!bound.has(id.name)) checkReference(id);
            },
          };
        },
      },
    },
  };
}

export default architecturePlugin(denoConfig.imports);
