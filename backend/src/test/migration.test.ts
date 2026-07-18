import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../db/schema.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, '../../drizzle');

function freshDb() {
  const client = new Database(':memory:');
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder });
  return { db, client };
}

describe('Migration 0004 (extended provider config)', () => {
  it('applies cleanly and adds new provider columns', () => {
    const { client } = freshDb();
    const cols = (client.prepare(`PRAGMA table_info(providers)`).all() as Array<{ name: string }>).map((c) => c.name);
    for (const expected of [
      'documentation_url',
      'auth_header',
      'auth_prefix',
      'models_endpoint',
      'chat_completions_endpoint',
      'embeddings_endpoint',
      'custom_headers_json',
      'timeout_ms',
      'health_check_endpoint',
      'capabilities_json',
    ]) {
      expect(cols).toContain(expected);
    }
  });

  it('applies sensible defaults on insert', () => {
    const { client } = freshDb();
    client
      .prepare(
        `INSERT INTO providers (id, type, name, slug, base_url, enabled, priority, routing_weight, health_status, billing_mode, created_at, updated_at)
         VALUES ('p1', 'orcarouter', 'Orca', 'orca', 'https://api.orcarouter.ai/v1', 1, 0, 1, 'unknown', 'unknown', 1, 1)`
      )
      .run();

    const row = client.prepare(`SELECT * FROM providers WHERE id = 'p1'`).get() as Record<string, unknown>;
    expect(row.auth_header).toBe('Authorization');
    expect(row.auth_prefix).toBe('Bearer ');
    expect(row.models_endpoint).toBe('/models');
    expect(row.chat_completions_endpoint).toBe('/chat/completions');
    expect(row.documentation_url).toBeNull();
    expect(row.capabilities_json).toBeNull();
  });

  it('accepts the new provider types', () => {
    const { client } = freshDb();
    ['orcarouter', 'openai_compatible', 'mimo', 'featherless'].forEach((type, i) => {
      client
        .prepare(
          `INSERT INTO providers (id, type, name, slug, base_url, enabled, priority, routing_weight, health_status, billing_mode, created_at, updated_at)
           VALUES (?, ?, 'N', ?, 'https://api.example.com', 1, 0, 1, 'unknown', 'unknown', 1, 1)`
        )
        .run(`id-${i}`, type, `slug-${i}`);
    });

    const count = client.prepare(`SELECT count(*) as c FROM providers`).get() as { c: number };
    expect(count.c).toBe(4);
  });
});
