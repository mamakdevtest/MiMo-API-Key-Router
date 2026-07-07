import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import { config } from './config.js';
import { createDb } from './db/index.js';
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

const db = createDb(config.databaseUrl);

await setupAdmin(db);

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

const frontendDist = path.resolve(__dirname, '../../frontend/dist');
await app.register(staticPlugin, {
  root: frontendDist,
  prefix: '/',
  wildcard: false,
});

app.get('/*', async (req, reply) => {
  return reply.sendFile('index.html', frontendDist);
});

app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
  request.log.error({ err: error }, 'Unhandled error');
  reply.status(error.statusCode || 500).send({
    error: 'Internal Server Error',
    message: config.nodeEnv === 'development' ? error.message : undefined,
  });
});

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/') || request.url.startsWith('/admin/')) {
    reply.status(404).send({ error: 'Not Found' });
  } else {
    reply.sendFile('index.html', frontendDist);
  }
});

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`MiMo API Key Router listening on port ${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
