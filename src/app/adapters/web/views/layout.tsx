import type { Child, FC } from 'hono/jsx';

export const Layout: FC<{ title: string; version: string; children: Child }> = ({
  title,
  version,
  children,
}) => (
  <html lang='en'>
    <head>
      <meta charSet='utf-8' />
      <meta name='viewport' content='width=device-width, initial-scale=1' />
      <title>{title}</title>
      <link rel='stylesheet' href='/static/vendor/oat-1.0.0.min.css' />
      <link rel='stylesheet' href='/static/app.css' />
      <script src='/static/vendor/oat-1.0.0.min.js' defer></script>
    </head>
    <body>
      <main class='container'>{children}</main>
      <footer class='container align-center text-light'>
        <small>Version {version}</small>
      </footer>
      <script type='module' src='/static/vendor/datastar-1.0.4.js'></script>
    </body>
  </html>
);
