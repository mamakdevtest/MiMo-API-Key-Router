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

describe('Provider and model benchmark migrations', () => {
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
    const initialCount = (client.prepare(`SELECT count(*) as c FROM providers`).get() as { c: number }).c;
    ['orcarouter', 'openai_compatible', 'mimo', 'featherless'].forEach((type, i) => {
      client
        .prepare(
          `INSERT INTO providers (id, type, name, slug, base_url, enabled, priority, routing_weight, health_status, billing_mode, created_at, updated_at)
           VALUES (?, ?, 'N', ?, 'https://api.example.com', 1, 0, 1, 'unknown', 'unknown', 1, 1)`
        )
        .run(`id-${i}`, type, `slug-${i}`);
    });

    const count = client.prepare(`SELECT count(*) as c FROM providers`).get() as { c: number };
    expect(count.c).toBe(initialCount + 4);
  });

  it('adds one latest-result row per provider model', () => {
    const { client } = freshDb();
    const cols = (client.prepare(`PRAGMA table_info(model_benchmark_results)`).all() as Array<{ name: string }>).map((column) => column.name);
    expect(cols).toEqual(expect.arrayContaining(['provider_model_id', 'outcome', 'latency_ms', 'http_status', 'error_message', 'tested_at']));
    const indexes = client.prepare(`PRAGMA index_list(model_benchmark_results)`).all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toContain('model_benchmark_results_tested_at_idx');
  });

  it('drops the removed temporary gateway credential table', () => {
    const { client } = freshDb();
    const table = client.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'gateway_credentials'").get();
    expect(table).toBeUndefined();
  });
});
