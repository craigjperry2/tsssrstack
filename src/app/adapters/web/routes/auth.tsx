import type { Hono } from 'hono';
import { normalizeEmail, validatePassword, validEmail } from '../../../domain/validation.ts';
import { form, page, requireUser, type WebDeps, type WebEnv } from '../context.tsx';
import { clearSession, issueSession } from '../session.ts';
import { Auth } from '../views/auth.tsx';

// Verified against when the email is unknown, so failed logins take the same time either way.
const dummyHash =
  '$argon2id$v=19$m=65536,t=3,p=1$MDEyMzQ1Njc4OWFiY2RlZg$6VcbVD4_7DRhmJYF2BLo1MoROci40oH3Yx4kqPFSRo0';

export function authRoutes(app: Hono<WebEnv>, { users, passwords, session }: WebDeps) {
  app.get(
    '/register',
    (c) => c.get('user') ? c.redirect('/tasks') : page(c, 'Register', <Auth mode='register' />),
  );
  app.post('/register', async (c) => {
    const data = await form(c);
    const email = normalizeEmail(data.email ?? '');
    const password = data.password ?? '';
    const invalid = !validEmail(email)
      ? 'Enter a valid email address.'
      : validatePassword(password, email);
    if (invalid) return page(c, 'Register', <Auth mode='register' error={invalid} />);
    try {
      const user = await users.create(email, await passwords.hash(password));
      await issueSession(c, session, { userId: user.id, sessionVersion: user.session_version });
      return c.redirect('/tasks', 303);
    } catch {
      return page(c, 'Register', <Auth mode='register' error='Unable to create that account.' />);
    }
  });
  app.get(
    '/login',
    (c) => c.get('user') ? c.redirect('/tasks') : page(c, 'Login', <Auth mode='login' />),
  );
  app.post('/login', async (c) => {
    const data = await form(c);
    const user = await users.byEmail(normalizeEmail(data.email ?? ''));
    const ok = await passwords.verify(data.password ?? '', user?.password_hash ?? dummyHash);
    if (!user || !ok) {
      return page(c, 'Login', <Auth mode='login' error='Invalid email or password.' />);
    }
    await issueSession(c, session, { userId: user.id, sessionVersion: user.session_version });
    return c.redirect('/tasks', 303);
  });
  app.post('/logout', requireUser, (c) => {
    clearSession(c);
    return c.redirect('/login', 303);
  });
}
