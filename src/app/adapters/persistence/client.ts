import postgres from 'postgres';
import type { Config } from '../../config.ts';
// postgres.js returns int8 (bigint/bigserial) as strings; the domain types use safe integers.
function parseInt8(raw: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new RangeError(`int8 value out of range: ${raw}`);
  return value;
}
export const createSql = (config: Config) =>
  postgres(config.databaseUrl, {
    max: 10,
    idle_timeout: 20,
    types: {
      int8: { to: 20, from: [20], serialize: (value: number) => String(value), parse: parseInt8 },
    },
  });
export const queryPath = (name: string) => new URL(`./sql/${name}.sql`, import.meta.url).pathname;
