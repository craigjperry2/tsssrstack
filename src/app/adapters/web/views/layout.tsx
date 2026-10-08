import type { Child, FC } from 'hono/jsx';
export const Layout: FC<{ title: string; children: Child }> = ({ title, children }) => (
  <html lang='en'>
    <head>
      <meta charSet='utf-8' />
      <meta name='viewport' content='width=device-width, initial-scale=1' />
      <title>{title}</title>
      <link rel='stylesheet' href='/static/vendor/pico-2.1.1.min.css' />
      <link rel='stylesheet' href='/static/app.css' />
    </head>
    <body>
      <main class='container'>{children}</main>
      <script type='module' src='/static/vendor/datastar-1.0.2.js'></script>
    </body>
  </html>
);
