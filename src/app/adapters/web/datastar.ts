import type { Context } from 'hono';
import type { Child } from 'hono/jsx';
import { streamSSE } from 'hono/streaming';

// The only place that turns rendered JSX into Datastar SSE events. Elements arrive here already
// escaped by Hono JSX, and expressions are built only from server-generated URLs.
export type Patch = { event: string; data: string };

export const postExpr = (url: string) => `@post('${url}', {contentType: 'form'})`;
export const getExpr = (url: string) => `@get('${url}')`;

// Default mode morphs the element with the same id. `replace` swaps it outright, which also
// bypasses a data-ignore-morph guard.
export const patchElements = async (element: Child, mode?: 'replace'): Promise<Patch> => ({
  event: 'datastar-patch-elements',
  data: `${mode ? `mode ${mode}\n` : ''}elements ${await element}`,
});

export const patchSignals = (signals: Record<string, string>): Patch => ({
  event: 'datastar-patch-signals',
  data: `signals ${JSON.stringify(signals)}`,
});

// A finite SSE response: every patch is written, then the stream closes.
export function sse(c: Context, patches: Patch[]) {
  c.header('Cache-Control', 'no-cache');
  c.header('X-Accel-Buffering', 'no');
  c.header('Vary', 'Accept-Encoding');
  return streamSSE(c, async (stream) => {
    // Hono prefixes every physical data line, preserving valid SSE framing for
    // multiline JSX while Datastar receives the required `elements <html>` payload.
    for (const patch of patches) await stream.writeSSE(patch);
  });
}
