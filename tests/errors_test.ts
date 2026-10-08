import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { handleError } from '../src/app/adapters/web/errors.ts';
const assertEquals = (actual: unknown, expected: unknown) => {
  if (actual !== expected) throw new Error(`Expected ${expected}, received ${actual}`);
};

function app() {
  const app = new Hono<{ Variables: { requestId: string } }>();
  let reached = false;
  app.use('*', csrf({ origin: 'https://app.example' }));
  app.post('/register', (c) => {
    reached = true;
    return c.text('created');
  });
  app.get('/boom', () => {
    throw new Error('secret detail');
  });
  app.onError(handleError);
  return { app, reached: () => reached };
}

Deno.test('cross-origin form POST is rejected with 403 before the handler runs', async () => {
  const { app: server, reached } = app();
  const response = await server.request('/register', {
    method: 'POST',
    headers: {
      Origin: 'https://evil.example',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'email=x@y.z&password=whatever123',
  });
  assertEquals(response.status, 403);
  assertEquals(reached(), false);
});

Deno.test('same-origin form POST reaches the handler', async () => {
  const { app: server, reached } = app();
  const response = await server.request('/register', {
    method: 'POST',
    headers: {
      Origin: 'https://app.example',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'email=x@y.z',
  });
  assertEquals(response.status, 200);
  assertEquals(reached(), true);
});

Deno.test('unexpected errors become a generic 500', async () => {
  const error = console.error;
  console.error = () => {};
  try {
    const response = await app().app.request('/boom');
    assertEquals(response.status, 500);
    assertEquals(await response.text(), 'Internal server error');
  } finally {
    console.error = error;
  }
});
