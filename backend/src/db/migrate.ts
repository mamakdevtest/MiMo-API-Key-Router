import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function runMigrations(db: Db) {
  const migrationsFolder = path.resolve(__dirname, '../../drizzle');
  drizzleMigrate(db, { migrationsFolder });
  console.log('Migrations applied successfully');
}

// CLI mode: run when executed directly
if (process.argv[1] && (process.argv[1].endsWith('migrate.ts') || process.argv[1].endsWith('migrate.js'))) {
  const { createDb } = await import('./index.js');
  const { config } = await import('../config.js');
  const db = createDb(config.databaseUrl);
  runMigrations(db);
}
