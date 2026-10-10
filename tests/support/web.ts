import { createWebApp } from '../../src/app/adapters/web/app.tsx';
import type { WebDeps } from '../../src/app/adapters/web/context.tsx';
import { identityService } from '../../src/app/application/identity.ts';
import { taskService } from '../../src/app/application/tasks.ts';
import { fakePasswords, memoryTaskRepository, memoryUserRepository } from './fakes.ts';

export const origin = 'https://app.test';
export const password = 'correct-horse-battery';
// The web tests run on a fixed day: 2026-10-09 in UTC.
export const fixedClock = { now: () => new Date('2026-10-09T12:00:00Z') };

export function testApp(overrides: Partial<WebDeps> = {}) {
  return createWebApp({
    identity: identityService({ users: memoryUserRepository(), passwords: fakePasswords() }),
    tasks: taskService({ tasks: memoryTaskRepository(), clock: fixedClock }),
    session: { secret: 'test-secret-that-is-at-least-32-bytes-long', secure: false },
    appOrigin: origin,
    ready: () => Promise.resolve(true),
    ...overrides,
  });
}
type App = ReturnType<typeof testApp>;

// A same-origin browser request; form fields are sent form-encoded like Datastar's contentType: 'form'.
export function send(
  app: App,
  path: string,
  {
    fields,
    cookie,
    headers = {},
  }: {
    fields?: Record<string, string>;
    cookie?: string;
    headers?: Record<string, string>;
  } = {},
) {
  return app.request(path, {
    method: fields ? 'POST' : 'GET',
    headers: {
      Origin: origin,
      ...(fields && { 'Content-Type': 'application/x-www-form-urlencoded' }),
      ...(cookie && { Cookie: cookie }),
      ...headers,
    },
    body: fields && new URLSearchParams(fields),
  });
}

export const sessionCookie = (response: Response) =>
  response.headers.get('Set-Cookie')?.match(/app_session=[^;]*/)?.[0];

export async function signUp(app: App, email = 'person@example.test') {
  const response = await send(app, '/register', { fields: { email, password } });
  const cookie = sessionCookie(response);
  if (response.status !== 303 || !cookie) throw new Error(`sign-up failed: ${response.status}`);
  return cookie;
}

// The `event:` names of an SSE body, in order.
export const sseEvents = (body: string) => [...body.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
