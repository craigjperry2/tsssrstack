# 0001: Ports and adapters with a small domain core

- Status: accepted
- Date: 2026-10-09

## Context

This repository is a template, so its structure gets copied far more often than its features do. The
first version collapsed everything into `main.tsx`. Routes, session handling, use-case orchestration
and SSE encoding were all mixed together, the "domain" was a handful of validation functions, and
views imported database row types. The bootstrap plan had called for an application layer, ports and
architecture tests, but none of them existed.

The application is small, so the structure has to earn its keep. It should make the next feature
easier to place and test, without ceremony that a reader has to learn first.

## Decision

Use ports and adapters (hexagonal architecture) with four layers: domain, application, adapters and
a composition root. Dependencies point inwards only. The full rule is in
[ARCHITECTURE.md](../../ARCHITECTURE.md#the-dependency-rule).

- Domain types are readonly records, branded value types with checked constructors, and pure
  functions. Expected failures are `Result` values carrying problem codes, not exceptions or
  messages.
- Use cases are plain functions created by `taskService` and `identityService`, which receive their
  ports as arguments. There is no DI container and no class per use case.
- Ports exist only for what is outside the process or must be substituted in tests: repositories and
  the password hasher. Sessions, Sqids, rendering and readiness stay inside the web adapter or the
  composition root.
- Repositories keep their row types private and map rows to domain types. Owner scoping and
  atomicity are part of the port contracts and stay in SQL.
- A `deno lint` plugin enforces the dependency rule and keeps the core free of JSX, I/O, time and
  randomness.

## Consequences

- Domain and application tests run without HTTP or PostgreSQL. The web tests run against in-memory
  ports, and repository contracts are tested against a real database.
- A misplaced import fails `deno lint` in CI instead of eroding the layers over time.
- There are a few more files and names than a single-module app needs. A one-field change can touch
  every layer, which is the intended trade.
- Brands are erased at runtime. They prevent mistakes in TypeScript, not in data that arrives some
  other way, which is why the database keeps CHECK constraints that mirror the domain rules.
