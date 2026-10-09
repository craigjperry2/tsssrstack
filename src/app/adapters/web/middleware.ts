import type { MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { WebEnv } from './context.tsx';

// Central security controls, registered once in createWebApp before any route.

export const requestId: MiddlewareHandler<WebEnv> = async (c, next) => {
  c.set('requestId', c.req.header('X-Request-ID') ?? crypto.randomUUID());
  await next();
  c.header('X-Request-ID', c.get('requestId'));
};

// Datastar evaluates expressions with Function(), hence 'unsafe-eval'.
export const securityHeaders = secureHeaders({
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
});
