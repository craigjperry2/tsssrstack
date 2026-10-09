// A deno lint plugin that enforces the dependency rule in ARCHITECTURE.md, so a misplaced import
// fails `deno lint` (and CI) instead of quietly eroding the layers.
//
//   domain            → domain
//   application       → application, domain
//   adapters/<name>   → the same adapter, application, domain, external packages
//   composition root  → anything (src/app/main.tsx and src/app/config.ts; nothing imports them)
//
// Only files under src/app/ are governed. First-party imports must be relative paths.

type Layer = 'domain' | 'application' | 'composition' | `adapters/${string}`;

// The layer of a file under src/app/, null for an unrecognised location there, and undefined
// for files outside src/app/ (tests, tools).
function layerOf(path: string): Layer | null | undefined {
  const normalized = `/${path}`;
  const root = normalized.lastIndexOf('/src/app/');
  if (root < 0) return undefined;
  const parts = normalized.slice(root + '/src/app/'.length).split('/');
  if (parts.length === 1) return 'composition';
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

const plugin: Deno.lint.Plugin = {
  name: 'architecture',
  rules: {
    'layer-dependencies': {
      create(context) {
        const from = layerOf(context.filename);
        if (from === undefined) return {};
        const check = (node: Deno.lint.Node, specifier: string) => {
          if (from === null) return;
          if (!specifier.startsWith('.')) {
            if (pure(from)) {
              context.report({
                node,
                message: `${from} must not depend on '${specifier}'; only adapters use packages.`,
              });
            }
            return;
          }
          const target = new URL(specifier, `file:///${context.filename.replace(/^\/+/, '')}`);
          const to = layerOf(target.pathname);
          if (!to || !allowed(from, to)) {
            context.report({
              node,
              message: `${from} must not depend on ${to ?? target.pathname} ('${specifier}').`,
              hint: 'See the dependency rule in ARCHITECTURE.md.',
            });
          }
        };
        return {
          Program(node) {
            if (from === null) {
              context.report({
                node,
                message:
                  'Files under src/app/ belong in domain/, application/ or adapters/<name>/.',
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
    // an adapter concern.
    'pure-core': {
      create(context) {
        if (!pure(layerOf(context.filename))) return {};
        const report = (node: Deno.lint.Node, what: string) =>
          context.report({
            node,
            message: `${what} is not allowed in the domain or application layers.`,
            hint: 'Inject it through a port, such as Clock.',
          });
        return {
          JSXElement: (node) => report(node, 'JSX'),
          JSXFragment: (node) => report(node, 'JSX'),
          MemberExpression(node) {
            if (node.object.type !== 'Identifier') return;
            const property = node.property.type === 'Identifier' ? node.property.name : '';
            if (['Deno', 'crypto'].includes(node.object.name)) report(node, node.object.name);
            if (node.object.name === 'Date' && property === 'now') report(node, 'Date.now()');
            if (node.object.name === 'Math' && property === 'random') report(node, 'Math.random()');
          },
          NewExpression(node) {
            if (
              node.callee.type === 'Identifier' && node.callee.name === 'Date' &&
              node.arguments.length === 0
            ) report(node, 'new Date()');
          },
          CallExpression(node) {
            if (node.callee.type === 'Identifier' && node.callee.name === 'fetch') {
              report(node, 'fetch()');
            }
          },
        };
      },
    },
  },
};
export default plugin;
