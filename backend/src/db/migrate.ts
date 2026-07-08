import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './index.js';

export function runMigrations(db: Db) {
  drizzleMigrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations applied successfully');
}

// CLI mode: run when executed directly
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  const { createDb } = await import('./index.js');
  const { config } = await import('../config.js');
  const db = createDb(config.databaseUrl);
  runMigrations(db);
}
