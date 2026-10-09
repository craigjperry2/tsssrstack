import type { Hono } from 'hono';
import { validatePassword } from '../../../domain/validation.ts';
import { currentUser, form, page, requireUser, type WebDeps, type WebEnv } from '../context.tsx';
import { issueSession } from '../session.ts';
import { Profile } from '../views/profile.tsx';

export function profileRoutes(app: Hono<WebEnv>, { users, passwords, session }: WebDeps) {
  app.get('/profile', requireUser, (c) => page(c, 'Profile', <Profile />));
  app.post('/profile/password', requireUser, async (c) => {
    const user = currentUser(c);
    const data = await form(c);
    if (!await passwords.verify(data.currentPassword ?? '', user.password_hash)) {
      return c.text('Current password is incorrect.', 400);
    }
    const invalid = validatePassword(data.newPassword ?? '', user.email_normalized);
    if (invalid) return c.text(invalid, 400);
    const replacement = await users.changePassword(user.id, await passwords.hash(data.newPassword));
    await issueSession(c, session, {
      userId: replacement.id,
      sessionVersion: replacement.session_version,
    });
    return c.redirect('/profile', 303);
  });
}
