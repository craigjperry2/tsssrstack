import type { Hono } from 'hono';
import { currentUser, form, page, requireUser, type WebDeps, type WebEnv } from '../context.tsx';
import { passwordChangeMessage } from '../messages.ts';
import { issueSession } from '../session.ts';
import { Profile } from '../views/profile.tsx';

export function profileRoutes(app: Hono<WebEnv>, { identity, session }: WebDeps) {
  app.get('/profile', requireUser, (c) => page(c, 'Profile', <Profile />));
  app.post('/profile/password', requireUser, async (c) => {
    const data = await form(c);
    const changed = await identity.changePassword(
      currentUser(c).id,
      data.currentPassword ?? '',
      data.newPassword ?? '',
    );
    if (!changed.ok) return c.text(passwordChangeMessage(changed.error), 400);
    // Re-issue this browser's cookie at the new session version; every other session is revoked.
    const { id, sessionVersion } = changed.value;
    await issueSession(c, session, { userId: id, sessionVersion });
    return c.redirect('/profile', 303);
  });
}
