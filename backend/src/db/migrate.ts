import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from './index.js';
import { config } from '../config.js';

const db = createDb(config.databaseUrl);
migrate(db, { migrationsFolder: './drizzle' });
console.log('Migrations applied successfully');
