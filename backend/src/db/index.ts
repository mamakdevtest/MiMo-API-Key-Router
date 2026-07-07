import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export function createDb(databaseUrl: string) {
  const client = new Database(databaseUrl);
  client.pragma('journal_mode = WAL');
  client.pragma('foreign_keys = ON');
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
export { schema };
