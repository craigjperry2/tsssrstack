import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Child, FC } from 'hono/jsx';
import bulma from 'bulma/package.json' with { type: 'json' };

// Bulma comes from npm through package.json, so Dependabot updates it and pnpm-lock.yaml pins its
// integrity. It is read once, at startup. The version in the URL lets the stylesheet be cached as
// immutable.
export const bulmaHref = `/static/bulma-${bulma.version}.min.css`;
export const bulmaCss = readFileSync(
  fileURLToPath(import.meta.resolve('bulma/css/bulma.min.css')),
  'utf8',
);

export const Layout: FC<{ title: string; children: Child }> = ({ title, children }) => (
  <html lang='en'>
    <head>
      <meta charSet='utf-8' />
      <meta name='viewport' content='width=device-width, initial-scale=1' />
      <title>{title}</title>
      <link rel='stylesheet' href={bulmaHref} />
    </head>
    <body>
      <main class='section'>
        <div class='container is-max-desktop'>{children}</div>
      </main>
      <script type='module' src='/static/vendor/datastar-1.0.2.js'></script>
    </body>
  </html>
);
