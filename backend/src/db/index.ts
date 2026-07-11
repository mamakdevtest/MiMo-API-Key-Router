import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import path from 'node:path';
import fs from 'node:fs';

export function createDb(databaseUrl: string) {
  // Ensure the parent directory exists
  const dir = path.dirname(databaseUrl);
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const client = new Database(databaseUrl);
  client.pragma('journal_mode = WAL');
  client.pragma('foreign_keys = ON');
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
export { schema };
