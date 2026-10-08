import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

// Intentional HTTP errors (e.g. the csrf middleware's 403) keep their own response;
// anything else is an unexpected failure and is logged without leaking details.
export const handleError: ErrorHandler<{ Variables: { requestId: string } }> = (error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  console.error(
    JSON.stringify({ level: 'error', requestId: c.get('requestId'), message: error.message }),
  );
  return c.text('Internal server error', 500);
};
