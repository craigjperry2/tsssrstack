import { type Context, Hono, type Next } from 'hono';
import { csrf } from 'hono/csrf';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { serveStatic } from 'hono/deno';
import { streamSSE } from 'hono/streaming';
import { type Child } from 'hono/jsx';
import { loadConfig } from './config.ts';
import { normalizeEmail, taskInput, validatePassword, validEmail } from './domain/validation.ts';
import { hashPassword, verifyPassword } from './adapters/security/password.ts';
import { createSql } from './adapters/persistence/client.ts';
import { type Task, tasks, type User, users } from './adapters/persistence/repositories.ts';
import { devUserEmail, devUserPassword, seedDevUser } from './adapters/persistence/seed.ts';
import { Layout } from './adapters/web/views/layout.tsx';
import { App, appSqids, ClosedEditor, TaskEditor } from './adapters/web/views/app.tsx';
import { Auth } from './adapters/web/views/auth.tsx';
import { handleError } from './adapters/web/errors.ts';

type Variables = { user?: User; requestId: string };
type Session = { userId: number; sessionVersion: number; issuedAt: number; expiresAt: number };
const config = loadConfig();
const sql = createSql(config);
const userRepo = users(sql);
const taskRepo = tasks(sql);
// Development convenience account, only seeded when the server runs in development;
// test and production environments never touch this path.
if (config.env === 'development') {
  const seeded = await seedDevUser(sql);
  if (seeded) {
    console.log(`Seeded development user ${devUserEmail} / ${devUserPassword}`);
  }
}
const app = new Hono<{ Variables: Variables }>();
const cookieName = 'app_session';
const sessionLifetime = 60 * 60 * 12;
const dummyHash =
  '$argon2id$v=19$m=65536,t=3,p=1$MDEyMzQ1Njc4OWFiY2RlZg$6VcbVD4_7DRhmJYF2BLo1MoROci40oH3Yx4kqPFSRo0';
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
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: sessionLifetime,
    expires: new Date(Date.now() + sessionLifetime * 1000),
    secure: config.env === 'production',
  };
}
async function issue(c: Parameters<typeof setSignedCookie>[0], user: User) {
  const now = Math.floor(Date.now() / 1000);
  await setSignedCookie(
    c,
    cookieName,
    encode({
      userId: user.id,
      sessionVersion: user.session_version,
      issuedAt: now,
      expiresAt: now + sessionLifetime,
    }),
    config.sessionSecret,
    cookieOptions(),
  );
}
type AppContext = Context<{ Variables: Variables }>;
function page(
  c: AppContext,
  title: string,
  body: Child,
) {
  return c.html(<Layout title={title}>{body}</Layout>);
}
function idFrom(raw: string): number | undefined {
  try {
    const decoded = appSqids.decode(raw);
    return decoded.length === 1 && Number.isSafeInteger(decoded[0]) ? decoded[0] : undefined;
  } catch {
    return undefined;
  }
}
async function form(
  c: { req: { parseBody: () => Promise<Record<string, string | File>> } },
): Promise<Record<string, string>> {
  const data = await c.req.parseBody();
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, typeof value === 'string' ? value : '']),
  );
}
type Patch = { event: string; data: string };
function sse(c: AppContext, patches: Patch[]) {
  c.header('Cache-Control', 'no-cache');
  c.header('X-Accel-Buffering', 'no');
  c.header('Vary', 'Accept-Encoding');
  return streamSSE(c, async (stream) => {
    // Hono prefixes every physical data line, preserving valid SSE framing for
    // multiline JSX while Datastar receives the required `elements <html>` payload.
    for (const patch of patches) await stream.writeSSE(patch);
  });
}
// Fat morph of the whole #app region.
async function appPatch(
  user: User,
  values?: { title?: string; description?: string },
  errors?: Record<string, string>,
): Promise<Patch> {
  const element = await (
    <App
      email={user.email_normalized}
      items={await taskRepo.list(user.id)}
      values={values}
      errors={errors}
    />
  );
  return { event: 'datastar-patch-elements', data: `elements ${element}` };
}
// Swaps one element by id without morphing, bypassing its data-ignore-morph guard.
const replacePatch = async (element: Child): Promise<Patch> => ({
  event: 'datastar-patch-elements',
  data: `mode replace\nelements ${await element}`,
});
// After a successful add, reset the form's data-bind signals; a morph alone cannot clear
// what the user typed because it only reflects changed value attributes.
const clearAddForm: Patch = {
  event: 'datastar-patch-signals',
  data: `signals ${JSON.stringify({ title: '', description: '' })}`,
};
async function ownedTask(c: AppContext, user: User): Promise<Task | undefined> {
  const taskId = idFrom(c.req.param('publicId') ?? '');
  return taskId ? (await taskRepo.list(user.id)).find((task) => task.id === taskId) : undefined;
}

app.use('*', async (c, next) => {
  c.set('requestId', c.req.header('X-Request-ID') ?? crypto.randomUUID());
  await next();
  c.header('X-Request-ID', c.get('requestId'));
});
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-eval'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
    },
    referrerPolicy: 'strict-origin-when-cross-origin',
    xContentTypeOptions: 'nosniff',
    permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
  }),
);
app.use('*', csrf({ origin: config.appOrigin }));
app.use('*', async (c, next) => {
  const signed = await getSignedCookie(c, config.sessionSecret, cookieName);
  if (typeof signed === 'string') {
    const session = decode(signed);
    if (session && session.expiresAt > Math.floor(Date.now() / 1000)) {
      const user = await userRepo.byId(session.userId);
      if (user && user.session_version === session.sessionVersion) c.set('user', user);
    }
  }
  await next();
});
// serveStatic joins root with the full request path, which already starts with /static.
app.use('/static/*', serveStatic({ root: './src/app' }));
const protectedRoute = async (c: AppContext, next: Next) => {
  if (!c.get('user')) return c.redirect('/login');
  await next();
};

app.get('/', (c) => c.redirect(c.get('user') ? '/tasks' : '/login'));
app.get('/healthz', (c) => c.text('ok'));
app.get('/readyz', async (c) => {
  try {
    await sql`SELECT 1`;
    return c.text('ready');
  } catch {
    return c.text('unavailable', 503);
  }
});
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
    const user = await userRepo.create(email, await hashPassword(password));
    await issue(c, user);
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
  const user = await userRepo.byEmail(normalizeEmail(data.email ?? ''));
  const ok = await verifyPassword(data.password ?? '', user?.password_hash ?? dummyHash);
  if (!user || !ok) {
    return page(c, 'Login', <Auth mode='login' error='Invalid email or password.' />);
  }
  await issue(c, user);
  return c.redirect('/tasks', 303);
});
app.post('/logout', protectedRoute, (c) => {
  deleteCookie(c, cookieName, { path: '/' });
  return c.redirect('/login', 303);
});
app.get('/tasks', protectedRoute, async (c) => {
  const user = c.get('user')!;
  return page(
    c,
    'Tasks',
    <App email={user.email_normalized} items={await taskRepo.list(user.id)} />,
  );
});
app.post('/tasks', protectedRoute, async (c) => {
  const user = c.get('user')!;
  const data = await form(c);
  const values = { title: data.title ?? '', description: data.description ?? '' };
  const errors = taskInput(values.title, values.description);
  if (Object.keys(errors).length) return sse(c, [await appPatch(user, values, errors)]);
  await taskRepo.create(user.id, values.title.trim(), values.description);
  return sse(c, [await appPatch(user), clearAddForm]);
});
// Editing happens in a per-task editor row (see TaskEditor). Opening, closing and failed saves
// replace only that row; everything else fat-morphs #app and leaves open editors untouched.
app.get('/tasks/:publicId/edit', protectedRoute, async (c) => {
  const task = await ownedTask(c, c.get('user')!);
  return task ? sse(c, [await replacePatch(<TaskEditor task={task} />)]) : c.notFound();
});
app.get('/tasks/:publicId', protectedRoute, async (c) => {
  const task = await ownedTask(c, c.get('user')!);
  return task ? sse(c, [await replacePatch(<ClosedEditor taskId={task.id} />)]) : c.notFound();
});
app.post('/tasks/:publicId/edit', protectedRoute, async (c) => {
  const user = c.get('user')!;
  const task = await ownedTask(c, user);
  if (!task) return c.notFound();
  const data = await form(c);
  const values = { title: data.title ?? '', description: data.description ?? '' };
  const errors = taskInput(values.title, values.description);
  if (Object.keys(errors).length) {
    return sse(c, [await replacePatch(<TaskEditor task={task} values={values} errors={errors} />)]);
  }
  if (!(await taskRepo.edit(task.id, user.id, values.title.trim(), values.description)).length) {
    return c.notFound();
  }
  return sse(c, [await appPatch(user), await replacePatch(<ClosedEditor taskId={task.id} />)]);
});
for (const action of ['toggle', 'delete'] as const) {
  app.post(`/tasks/:publicId/${action}`, protectedRoute, async (c) => {
    const user = c.get('user')!;
    const taskId = idFrom(c.req.param('publicId') ?? '');
    if (!taskId) return c.notFound();
    const changed = action === 'toggle'
      ? await taskRepo.toggle(taskId, user.id)
      : await taskRepo.delete(taskId, user.id);
    return changed.length ? sse(c, [await appPatch(user)]) : c.notFound();
  });
}
app.get('/profile', protectedRoute, (c) =>
  page(
    c,
    'Profile',
    <div id='app'>
      <h1 class='title'>Change password</h1>
      <form method='post' action='/profile/password'>
        <div class='field'>
          <label class='label' htmlFor='current-password'>Current password</label>
          <div class='control'>
            <input
              class='input'
              id='current-password'
              required
              type='password'
              name='currentPassword'
            />
          </div>
        </div>
        <div class='field'>
          <label class='label' htmlFor='new-password'>New password</label>
          <div class='control'>
            <input class='input' id='new-password' required type='password' name='newPassword' />
          </div>
        </div>
        <button type='submit' class='button is-primary'>Change password</button>
      </form>
    </div>,
  ));
app.post('/profile/password', protectedRoute, async (c) => {
  const user = c.get('user')!;
  const data = await form(c);
  if (!await verifyPassword(data.currentPassword ?? '', user.password_hash)) {
    return c.text('Current password is incorrect.', 400);
  }
  const invalid = validatePassword(data.newPassword ?? '', user.email_normalized);
  if (invalid) return c.text(invalid, 400);
  const replacement = await userRepo.changePassword(user.id, await hashPassword(data.newPassword));
  await issue(c, replacement);
  return c.redirect('/profile', 303);
});
app.onError(handleError);

Deno.serve({ hostname: config.host, port: config.port }, app.fetch);
