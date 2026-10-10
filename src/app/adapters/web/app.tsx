import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { serveStatic } from '@hono/node-server/serve-static';
import type { WebDeps, WebEnv } from './context.tsx';
import { handleError } from './errors.ts';
import { requestId, securityHeaders } from './middleware.ts';
import { readSession } from './session.ts';
import { authRoutes } from './routes/auth.tsx';
import { profileRoutes } from './routes/profile.tsx';
import { taskRoutes } from './routes/tasks.tsx';
import { bulmaCss, bulmaHref } from './views/layout.tsx';

// The HTTP driving adapter. Security middleware is registered here, once, before every route,
// so no handler has to remember to opt in.
export function createWebApp(deps: WebDeps): Hono<WebEnv> {
  const app = new Hono<WebEnv>();
  app.use('*', requestId);
  app.use('*', securityHeaders);
  app.use('*', csrf({ origin: deps.appOrigin }));
  app.use('*', async (c, next) => {
    const claims = await readSession(c, deps.session);
    const user = claims && (await deps.identity.resolve(claims.userId, claims.sessionVersion));
    if (user) c.set('user', user);
    await next();
  });

  app.get(bulmaHref, (c) => {
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return c.body(bulmaCss, 200, { 'Content-Type': 'text/css; charset=utf-8' });
  });
  // The root is the static directory itself, the only one the process may read, so the /static
  // prefix comes off the request path before serveStatic joins the two.
  app.use(
    '/static/*',
    serveStatic({
      root: './src/app/static',
      rewriteRequestPath: (path) => path.slice('/static'.length),
    }),
  );

  app.get('/', (c) => c.redirect(c.get('user') ? '/tasks' : '/login'));
  app.get('/healthz', (c) => c.text('ok'));
  app.get('/readyz', async (c) =>
    (await deps.ready()) ? c.text('ready') : c.text('unavailable', 503),
  );
  authRoutes(app, deps);
  taskRoutes(app, deps);
  profileRoutes(app, deps);
  app.onError(handleError);
  return app;
}
