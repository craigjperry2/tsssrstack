import type { Child, FC } from 'hono/jsx';
export const Layout: FC<{ title: string; children: Child }> = ({ title, children }) => (
  <html lang='en'>
    <head>
      <meta charSet='utf-8' />
      <meta name='viewport' content='width=device-width, initial-scale=1' />
      <title>{title}</title>
      <link rel='stylesheet' href='/static/vendor/bulma-1.0.4.min.css' />
    </head>
    <body>
      <main class='section'>
        <div class='container is-max-desktop'>{children}</div>
      </main>
      <script type='module' src='/static/vendor/datastar-1.0.2.js'></script>
    </body>
  </html>
);
