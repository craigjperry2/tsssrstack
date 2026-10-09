import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';

// Signed, stateless session cookies. The persisted session version lets a password change
// revoke every cookie issued before it.
export type SessionSettings = Readonly<{ secret: string; secure: boolean }>;
export type SessionClaims = Readonly<{ userId: number; sessionVersion: number }>;
type Session = SessionClaims & { issuedAt: number; expiresAt: number };

const cookieName = 'app_session';
const lifetime = 60 * 60 * 12;

const encode = (value: Session) =>
  btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
function decode(value: string): Session | undefined {
  try {
    const object = JSON.parse(
      atob(
        value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4),
      ),
    ) as Session;
    return Number.isSafeInteger(object.userId) && Number.isSafeInteger(object.sessionVersion) &&
        Number.isSafeInteger(object.issuedAt) && Number.isSafeInteger(object.expiresAt)
      ? object
      : undefined;
  } catch {
    return undefined;
  }
}

export async function issueSession(c: Context, settings: SessionSettings, claims: SessionClaims) {
  const now = Math.floor(Date.now() / 1000);
  await setSignedCookie(
    c,
    cookieName,
    encode({
      userId: claims.userId,
      sessionVersion: claims.sessionVersion,
      issuedAt: now,
      expiresAt: now + lifetime,
    }),
    settings.secret,
    {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: lifetime,
      expires: new Date((now + lifetime) * 1000),
      secure: settings.secure,
    },
  );
}

// Returns the claims of a correctly signed, unexpired cookie. Whether they still identify a
// user is the identity module's decision.
export async function readSession(
  c: Context,
  settings: SessionSettings,
): Promise<SessionClaims | undefined> {
  const signed = await getSignedCookie(c, settings.secret, cookieName);
  if (typeof signed !== 'string') return undefined;
  const session = decode(signed);
  return session && session.expiresAt > Math.floor(Date.now() / 1000) ? session : undefined;
}

export const clearSession = (c: Context) => deleteCookie(c, cookieName, { path: '/' });
