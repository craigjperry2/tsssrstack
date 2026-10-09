import type { Context, MiddlewareHandler } from 'hono';
import type { Child } from 'hono/jsx';
import type { TaskService } from '../../application/tasks.ts';
import type { User, users } from '../persistence/repositories.ts';
import type { SessionSettings } from './session.ts';
import { Layout } from './views/layout.tsx';

// Everything the web adapter needs from the rest of the system, supplied by main.tsx.
export type WebDeps = Readonly<{
  users: ReturnType<typeof users>;
  tasks: TaskService;
  passwords: Readonly<{
    hash(password: string): Promise<string>;
    verify(password: string, hash: string): Promise<boolean>;
  }>;
  session: SessionSettings;
  appOrigin: string;
  ready(): Promise<boolean>;
}>;

export type WebEnv = { Variables: { user?: User; requestId: string } };
export type AppContext = Context<WebEnv>;

export const page = (c: AppContext, title: string, body: Child) =>
  c.html(<Layout title={title}>{body}</Layout>);

// Form fields as strings; file parts are ignored.
export async function form(c: AppContext): Promise<Record<string, string>> {
  const data = await c.req.parseBody();
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, typeof value === 'string' ? value : '']),
  );
}

export const requireUser: MiddlewareHandler<WebEnv> = async (c, next) => {
  if (!c.get('user')) return c.redirect('/login');
  await next();
};

// Only valid behind requireUser.
export const currentUser = (c: AppContext): User => c.get('user')!;
