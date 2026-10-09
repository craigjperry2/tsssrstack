// HTTP-level behaviour of the web adapter, driven through createWebApp with in-memory adapters.
import { assert, assertEquals } from '../support/assert.ts';
import { password, send, sessionCookie, signUp, sseEvents, testApp } from '../support/web.ts';

const publicIds = (html: string) =>
  [...html.matchAll(/\/tasks\/([^/']+)\/toggle/g)].map((m) => m[1]);

Deno.test('cross-origin form POSTs are rejected before any handler runs', async () => {
  const app = testApp();
  const cookie = await signUp(app);
  const response = await send(app, '/tasks', {
    fields: { title: 'Injected' },
    cookie,
    headers: { Origin: 'https://evil.example' },
  });
  assertEquals(response.status, 403);
  assert(!(await (await send(app, '/tasks', { cookie })).text()).includes('Injected'), 'no task');
});

Deno.test('responses carry the central security headers', async () => {
  const response = await testApp().request('/login');
  const csp = response.headers.get('Content-Security-Policy') ?? '';
  assert(csp.includes("script-src 'self' 'unsafe-eval'"), csp);
  assert(csp.includes("frame-ancestors 'none'"), csp);
  assertEquals(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert(response.headers.get('X-Request-ID'), 'request id is echoed');
});

Deno.test('unexpected errors become a generic 500 without leaking details', async () => {
  const app = testApp({ ready: () => Promise.reject(new Error('secret detail')) });
  const logged: string[] = [];
  const original = console.error;
  console.error = (message: string) => logged.push(message);
  try {
    const response = await app.request('/readyz');
    assertEquals(response.status, 500);
    assertEquals(await response.text(), 'Internal server error');
  } finally {
    console.error = original;
  }
  assert(logged.some((line) => line.includes('secret detail')), 'details are logged');
});

Deno.test('signed-out visitors are sent to the login page', async () => {
  const response = await testApp().request('/tasks');
  assertEquals(response.status, 302);
  assertEquals(response.headers.get('Location'), '/login');
});

Deno.test('registration issues an HttpOnly, SameSite=Lax session cookie', async () => {
  const app = testApp();
  const response = await send(app, '/register', {
    fields: { email: ' Person@Example.TEST ', password },
  });
  assertEquals(response.status, 303);
  const header = response.headers.get('Set-Cookie') ?? '';
  assert(/HttpOnly/.test(header) && /SameSite=Lax/.test(header), header);
  const page = await (await send(app, '/tasks', { cookie: sessionCookie(response) })).text();
  assert(page.includes('person@example.test'), 'signed in as the normalised email');
});

Deno.test('registration rejects invalid input and duplicate emails', async () => {
  const app = testApp();
  const invalid = await send(app, '/register', { fields: { email: 'nope', password } });
  assert((await invalid.text()).includes('Enter a valid email address.'), 'invalid email');
  const weak = await send(app, '/register', { fields: { email: 'a@b.test', password: 'short' } });
  assert((await weak.text()).includes('Password must be 12 to 128 characters.'), 'weak');
  await signUp(app, 'taken@example.test');
  const duplicate = await send(app, '/register', {
    fields: { email: 'taken@example.test', password },
  });
  assertEquals(sessionCookie(duplicate), undefined);
  assert((await duplicate.text()).includes('Unable to create that account.'), 'duplicate');
});

Deno.test('login failures do not reveal whether the email exists', async () => {
  const app = testApp();
  await signUp(app);
  const wrong = await send(app, '/login', {
    fields: { email: 'person@example.test', password: 'wrong-password-123' },
  });
  const unknown = await send(app, '/login', { fields: { email: 'who@example.test', password } });
  for (const response of [wrong, unknown]) {
    assertEquals(sessionCookie(response), undefined);
    assert((await response.text()).includes('Invalid email or password.'), 'generic error');
  }
  const ok = await send(app, '/login', { fields: { email: 'PERSON@example.test', password } });
  assertEquals(ok.status, 303);
  assert(sessionCookie(ok), 'session issued');
});

Deno.test('a tampered session cookie is ignored', async () => {
  const app = testApp();
  const cookie = await signUp(app);
  const tampered = cookie.replace(/.$/, (last) => last === 'A' ? 'B' : 'A');
  assertEquals((await send(app, '/tasks', { cookie: tampered })).status, 302);
});

Deno.test('logout clears the session cookie', async () => {
  const app = testApp();
  const response = await send(app, '/logout', { fields: {}, cookie: await signUp(app) });
  assertEquals(response.status, 303);
  assert(/app_session=;.*Max-Age=0/.test(response.headers.get('Set-Cookie') ?? ''), 'cleared');
});

Deno.test('task commands answer with one finite SSE fat morph of #app', async () => {
  const app = testApp();
  const cookie = await signUp(app);
  const added = await send(app, '/tasks', {
    fields: { title: '  Buy milk ', description: '' },
    cookie,
  });
  assertEquals(added.headers.get('Content-Type'), 'text/event-stream');
  const addedBody = await added.text();
  // Success also resets the add form's bound signals.
  assertEquals(sseEvents(addedBody), ['datastar-patch-elements', 'datastar-patch-signals']);
  assert(addedBody.includes('data: elements <div id="app">'), 'whole #app region');
  assert(addedBody.includes('<strong>Buy milk</strong>'), 'trimmed title rendered');

  const invalid = await (await send(app, '/tasks', { fields: { title: ' ' }, cookie })).text();
  assertEquals(sseEvents(invalid), ['datastar-patch-elements']);
  assert(invalid.includes('Title is required.'), 'validation error rendered in #app');

  const [id] = publicIds(addedBody);
  const toggled = await (await send(app, `/tasks/${id}/toggle`, { fields: {}, cookie })).text();
  assertEquals(sseEvents(toggled), ['datastar-patch-elements']);
  assert(toggled.includes('<s>Buy milk</s>'), 'completed task struck through');
  const deleted = await (await send(app, `/tasks/${id}/delete`, { fields: {}, cookie })).text();
  assert(deleted.includes('No tasks yet.'), 'task removed');
});

Deno.test('editing replaces only the editor row until the save succeeds', async () => {
  const app = testApp();
  const cookie = await signUp(app);
  const [id] = publicIds(
    await (await send(app, '/tasks', { fields: { title: 'Draft' }, cookie })).text(),
  );
  const opened = await (await send(app, `/tasks/${id}/edit`, { cookie })).text();
  assert(opened.includes(`data: mode replace\ndata: elements <tr id="edit-${id}"`), opened);
  assert(opened.includes('value="Draft"'), 'editor prefilled');

  const rejected = await (await send(app, `/tasks/${id}/edit`, {
    fields: { title: '' },
    cookie,
  })).text();
  assertEquals(sseEvents(rejected), ['datastar-patch-elements']);
  assert(rejected.includes('mode replace') && rejected.includes('Title is required.'), rejected);

  const saved = await (await send(app, `/tasks/${id}/edit`, {
    fields: { title: 'Final', description: 'Done' },
    cookie,
  })).text();
  assertEquals(sseEvents(saved), ['datastar-patch-elements', 'datastar-patch-elements']);
  const [morph, close] = saved.split('\n\n');
  assert(morph.includes('<div id="app">') && morph.includes('<strong>Final</strong>'), morph);
  assert(close.includes(`mode replace\ndata: elements <tr id="edit-${id}"`), close);
  assert(close.includes('hidden'), 'editor closed');

  const cancelled = await (await send(app, `/tasks/${id}`, { cookie })).text();
  assert(cancelled.includes('mode replace') && cancelled.includes('hidden'), cancelled);
});

Deno.test("users cannot read or change each other's tasks", async () => {
  const app = testApp();
  const owner = await signUp(app, 'owner@example.test');
  const [id] = publicIds(
    await (await send(app, '/tasks', { fields: { title: 'Private' }, cookie: owner })).text(),
  );
  const other = await signUp(app, 'other@example.test');
  for (const path of [`/tasks/${id}/toggle`, `/tasks/${id}/delete`, `/tasks/${id}/edit`]) {
    assertEquals((await send(app, path, { fields: { title: 'Mine' }, cookie: other })).status, 404);
  }
  assertEquals((await send(app, `/tasks/${id}/edit`, { cookie: other })).status, 404);
  assertEquals(
    (await send(app, '/tasks/not-an-id/toggle', { fields: {}, cookie: owner })).status,
    404,
  );
  const page = await (await send(app, '/tasks', { cookie: owner })).text();
  assert(page.includes('<strong>Private</strong>'), 'owner task untouched');
});

Deno.test('changing the password revokes every older session', async () => {
  const app = testApp();
  const cookie = await signUp(app);
  const wrong = await send(app, '/profile/password', {
    fields: { currentPassword: 'not-my-password', newPassword: 'another-long-password' },
    cookie,
  });
  assertEquals(wrong.status, 400);
  const changed = await send(app, '/profile/password', {
    fields: { currentPassword: password, newPassword: 'another-long-password' },
    cookie,
  });
  assertEquals(changed.status, 303);
  assertEquals((await send(app, '/tasks', { cookie })).status, 302);
  assertEquals((await send(app, '/tasks', { cookie: sessionCookie(changed) })).status, 200);
  const relogin = await send(app, '/login', {
    fields: { email: 'person@example.test', password: 'another-long-password' },
  });
  assertEquals(relogin.status, 303);
});

Deno.test('due dates are validated and overdue tasks are flagged as of today (UTC)', async () => {
  const app = testApp(); // its clock reads 2026-10-09
  const cookie = await signUp(app);
  const rejected = await (await send(app, '/tasks', {
    fields: { title: 'Pay rent', dueDate: '2026-02-30' },
    cookie,
  })).text();
  assert(rejected.includes('Enter a real date for the due date.'), rejected);
  assert(rejected.includes('value="2026-02-30"'), 'submitted date is kept');

  for (const [title, dueDate] of [['Pay rent', '2026-10-08'], ['File taxes', '2026-10-09']]) {
    await send(app, '/tasks', { fields: { title, dueDate }, cookie });
  }
  const page = await (await send(app, '/tasks', { cookie })).text();
  assert(page.includes('Overdue · due 2026-10-08'), 'due yesterday is overdue');
  assert(page.includes('Due 2026-10-09') && !page.includes('Overdue · due 2026-10-09'), page);

  const added = await (await send(app, '/tasks', { fields: { title: 'Later' }, cookie })).text();
  assert(added.includes('"dueDate":""'), 'the add form clears its due date signal');
});
