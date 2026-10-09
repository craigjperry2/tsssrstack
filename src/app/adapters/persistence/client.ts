import postgres, { type Sql } from 'postgres';
// postgres.js returns int8 (bigint/bigserial) as strings; the domain types use safe integers.
function parseInt8(raw: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new RangeError(`int8 value out of range: ${raw}`);
  return value;
}
// Transactions use PostgreSQL's default READ COMMITTED on purpose. Every invariant is on a single
// row (domains, row triggers) or a unique index (email), so no read-then-write can skew. A rule
// spanning rows, such as a per-user task quota, would need SERIALIZABLE plus retry (docs/adr/0004).
export const createSql = (databaseUrl: string) =>
  postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    types: {
      int8: { to: 20, from: [20], serialize: (value: number) => String(value), parse: parseInt8 },
    },
  });
// What repositories need: a pool or a transaction, so callers can group operations atomically.
export type Db = Pick<Sql, 'file'>;
// The one way to load SQL: a parameterised .sql file next to this module.
export const queryPath = (name: string) => new URL(`./sql/${name}.sql`, import.meta.url).pathname;
