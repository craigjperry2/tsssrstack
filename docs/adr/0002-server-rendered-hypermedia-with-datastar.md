# 0002: Server-rendered hypermedia with Datastar

- Status: accepted
- Date: 2026-10-09

## Context

Interactive pages usually lead to a client-side state model that duplicates the server's. That means
a JSON API, a build pipeline and a second copy of the validation rules. The goal here is the
opposite: one source of truth and as few moving parts as possible.

## Decision

- The server renders HTML with Hono JSX only. Untrusted values reach the page as escaped text or
  attribute values, never as markup.
- Datastar sends form-encoded commands. Each command gets a **finite** SSE response, and there are
  no persistent streams or broadcasters.
- The default response is a **fat morph**: the whole `#app` region is re-rendered from current state
  and morphed into place. The exceptions are deliberate and documented. Editor rows use
  `data-ignore-morph` and `mode replace`, so an open editor survives other actions. A successful add
  also patches signals to clear the form.
- Datastar expressions are code. They are built only from server-generated URLs, by the helpers in
  `adapters/web/datastar.ts`.
- Datastar evaluates expressions with `Function()`, so the CSP allows `'unsafe-eval'`. Everything
  else stays restrictive: `default-src 'self'`, no objects, no framing, no base URI, and same-origin
  forms and connections only.

## Consequences

- There is no duplicated client state and no frontend build. A feature is a route, a view and a use
  case.
- `'unsafe-eval'` removes one defence against turning attacker-controlled strings into code. The
  invariant that untrusted data never becomes an expression therefore carries real weight, and it is
  concentrated in one module.
- Fat morphs send more bytes than minimal fragments. Compression and the small page size make that
  cheap, and in return a fragment can never drift from the full render.
- An open page does not update by itself when time passes or another tab changes data. The next
  request brings it up to date.
