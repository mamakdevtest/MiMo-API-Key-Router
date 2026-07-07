import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '../db/index.js';
import { registerAuth } from '../auth/index.js';
import { registerProxyRoutes } from '../routes/proxy.js';
import { registerAdminRoutes } from '../routes/admin.js';
import { setupAdmin } from '../services/setup.js';
import { config } from '../config.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildTestApp() {
  const db = createDb(':memory:');
  migrate(db, { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
  const gatewayKey = await setupAdmin(db);

  const app = Fastify({ logger: false, trustProxy: false });
  await app.register(cookie, {
    secret: config.sessionSecret,
    parseOptions: { httpOnly: true, secure: false, sameSite: 'lax', path: '/' },
  });

  await registerAuth(app, db);
  await registerProxyRoutes(app, db);
  await registerAdminRoutes(app, db);

  return { app, db, gatewayKey: gatewayKey! };
}

export async function adminLogin(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/admin/login',
    payload: { password: 'test-admin-password' },
  });
  const cookies = res.cookies as Array<{ name: string; value: string }>;
  const sessionCookie = cookies.find((c) => c.name === 'admin_session');
  if (!sessionCookie) {
    throw new Error(`No session cookie. Status: ${res.statusCode}, Body: ${res.payload}`);
  }
  return sessionCookie.value;
}
