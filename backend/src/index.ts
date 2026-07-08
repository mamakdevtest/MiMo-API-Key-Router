import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import { config } from './config.js';
import { createDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { setupAdmin } from './services/setup.js';
import { registerAuth } from './auth/index.js';
import { registerProxyRoutes } from './routes/proxy.js';
import { registerAdminRoutes } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: {
    level: config.logLevel,
    transport: config.nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
  },
  trustProxy: config.trustProxy,
});

// ── Database setup (never crash the server) ────────────────
try {
  const db = createDb(config.databaseUrl);

  try {
    runMigrations(db);
  } catch (err) {
    app.log.error({ err }, 'Migration failed — continuing with existing schema');
  }

  try {
    await setupAdmin(db);
  } catch (err) {
    app.log.error({ err }, 'Setup admin failed');
  }

  await app.register(cors, {
    origin: config.nodeEnv === 'development',
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
  });

  await app.register(cookie, {
    secret: config.sessionSecret,
    parseOptions: {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      path: '/',
    },
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip || 'unknown',
  });

  await registerAuth(app, db);
  await registerProxyRoutes(app, db);
  await registerAdminRoutes(app, db);

  // ── Frontend static files ────────────────────────────────
  const frontendDist = path.resolve(__dirname, '../../frontend/dist');

  // Check if frontend dist exists
  const indexExists = fs.existsSync(path.join(frontendDist, 'index.html'));

  if (indexExists) {
    await app.register(staticPlugin, {
      root: frontendDist,
      prefix: '/',
      wildcard: false,
    });

    // SPA fallback: serve index.html for all non-API routes
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/admin/') || request.url.startsWith('/v1/')) {
        reply.status(404).send({ error: 'Not Found' });
      } else {
        reply.sendFile('index.html', frontendDist);
      }
    });
  } else {
    app.log.warn('Frontend dist not found — serving API only');
    app.setNotFoundHandler((_request, reply) => {
      reply.status(404).send({ error: 'Not Found' });
    });
  }

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    request.log.error({ err: error }, 'Unhandled error');
    reply.status(error.statusCode || 500).send({
      error: 'Internal Server Error',
      message: config.nodeEnv === 'development' ? error.message : undefined,
    });
  });

  try {
    const address = await app.listen({ port: config.port, host: config.host });
    app.log.info(`MiMo API Key Router listening on ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
} catch (err) {
  console.error('Fatal startup error:', err);
  process.exit(1);
}
