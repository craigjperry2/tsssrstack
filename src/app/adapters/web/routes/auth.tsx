import type { Hono } from 'hono';
import { form, page, requireUser, type WebDeps, type WebEnv } from '../context.tsx';
import { loginMessage, registrationMessage } from '../messages.ts';
import { clearSession, issueSession } from '../session.ts';
import { Auth } from '../views/auth.tsx';

export function authRoutes(app: Hono<WebEnv>, { identity, session }: WebDeps) {
  app.get('/register', (c) =>
    c.get('user') ? c.redirect('/tasks') : page(c, 'Register', <Auth mode='register' />),
  );
  app.post('/register', async (c) => {
    const data = await form(c);
    const registered = await identity.register(data.email ?? '', data.password ?? '');
    if (!registered.ok) {
      return page(
        c,
        'Register',
        <Auth mode='register' error={registrationMessage(registered.error)} />,
      );
    }
    const { id, sessionVersion } = registered.value;
    await issueSession(c, session, { userId: id, sessionVersion });
    return c.redirect('/tasks', 303);
  });
  app.get('/login', (c) =>
    c.get('user') ? c.redirect('/tasks') : page(c, 'Login', <Auth mode='login' />),
  );
  app.post('/login', async (c) => {
    const data = await form(c);
    const loggedIn = await identity.logIn(data.email ?? '', data.password ?? '');
    if (!loggedIn.ok) return page(c, 'Login', <Auth mode='login' error={loginMessage} />);
    const { id, sessionVersion } = loggedIn.value;
    await issueSession(c, session, { userId: id, sessionVersion });
    return c.redirect('/tasks', 303);
  });
  app.post('/logout', requireUser, (c) => {
    clearSession(c);
    return c.redirect('/login', 303);
  });
}
