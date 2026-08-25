import postgres from 'postgres';
import type { Config } from '../../config.ts';
export const createSql = (config: Config) =>
  postgres(config.databaseUrl, { max: 10, idle_timeout: 20 });
export const queryPath = (name: string) => new URL(`./sql/${name}.sql`, import.meta.url).pathname;
