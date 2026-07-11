import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { verifyGatewayKey, verifyPassword, hashPassword, hashGatewayKey, generateSecureToken } from '../crypto/index.js';
import { settings, adminSessions, gatewayCredentials } from '../db/schema.js';
import type { Db } from '../db/index.js';

const SESSION_COOKIE = 'admin_session';
const CSRF_HEADER = 'x-csrf-token';

export interface AdminAuthContext {
  isAdmin: true;
}

declare module 'fastify' {
  interface FastifyRequest {
    adminSession?: AdminAuthContext;
  }
}

function parseForwardedFor(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const first = header.split(',')[0]?.trim();
  return first || undefined;
}

export function getClientIp(request: FastifyRequest): string {
  if (config.trustProxy) {
    const forwarded = parseForwardedFor(request.headers['x-forwarded-for'] as string | undefined);
    if (forwarded) return forwarded;
    const realIp = request.headers['x-real-ip'] as string | undefined;
    if (realIp) return realIp;
  }
  return request.ip;
}

function parseAllowlist(allowlist: string): Array<{ type: 'ip' | 'cidr'; value: string; prefix?: number }> {
  return allowlist
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.includes('/')) {
        return { type: 'cidr' as const, value: entry.split('/')[0], prefix: parseInt(entry.split('/')[1], 10) };
      }
      return { type: 'ip' as const, value: entry };
    });
}

function ipToBuffer(ip: string): Buffer {
  if (ip.includes(':')) {
    const parts = ip.split(':');
    const groups = new Array(8).fill('0');
    const expandIndex = parts.indexOf('');
    if (expandIndex !== -1) {
      const nonEmpty = parts.filter((p) => p !== '');
      const zeros = 8 - nonEmpty.length;
      const expanded = [...parts.slice(0, expandIndex), ...Array(zeros).fill('0'), ...parts.slice(expandIndex + 1)];
      for (let i = 0; i < 8; i++) groups[i] = expanded[i] || '0';
    } else {
      for (let i = 0; i < parts.length; i++) groups[i] = parts[i];
    }
    const buf = Buffer.alloc(16);
    for (let i = 0; i < 8; i++) {
      buf.writeUInt16BE(parseInt(groups[i], 16), i * 2);
    }
    return buf;
  }
  return Buffer.from(ip.split('.').map((n) => parseInt(n, 10)));
}

function isIpAllowed(clientIp: string, allowlist: string): boolean {
  const rules = parseAllowlist(allowlist);
  if (rules.length === 0) return true;

  const clientBuf = ipToBuffer(clientIp);
  const isV6 = clientIp.includes(':');

  for (const rule of rules) {
    const ruleIsV6 = rule.value.includes(':');
    if (isV6 !== ruleIsV6) continue;

    if (rule.type === 'ip') {
      if (clientBuf.equals(ipToBuffer(rule.value))) return true;
    } else if (rule.type === 'cidr' && rule.prefix !== undefined) {
      const ruleBuf = ipToBuffer(rule.value);
      const bytes = Math.floor(rule.prefix / 8);
      const remainder = rule.prefix % 8;
      let match = true;
      for (let i = 0; i < bytes; i++) {
        if (clientBuf[i] !== ruleBuf[i]) {
          match = false;
          break;
        }
      }
      if (match && remainder > 0) {
        const mask = (0xff << (8 - remainder)) & 0xff;
        match = (clientBuf[bytes] & mask) === (ruleBuf[bytes] & mask);
      }
      if (match) return true;
    }
  }
  return false;
}

export async function registerAuth(app: FastifyInstance, db: Db) {
  app.decorateRequest('adminSession', undefined);

  app.addHook('onRequest', async (request, reply) => {
    const publicPaths = ['/v1/models', '/v1/chat/completions', '/v1/completions', '/v1/embeddings', '/v1/tokenize', '/v1/messages'];
    if (!publicPaths.some((p) => request.url === p || request.url.startsWith(p + '?'))) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Missing Authorization header' });
    }

    const parts = authHeader.split(' ');
    const token = parts.length === 2 && parts[0].toLowerCase() === 'bearer' ? parts[1] : authHeader;

    const setting = await db.query.settings.findFirst();
    if (!setting) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // Check main gateway key first
    const valid = await verifyGatewayKey(setting.gatewayKeyHash, token);

    if (!valid) {
      // Check temporary credentials
      const tempCreds = await db.query.gatewayCredentials.findMany({
        where: (gc, { eq, and }) => and(eq(gc.isActive, true)),
      });

      let tempValid = false;
      let tempCred: typeof tempCreds[number] | undefined;

      for (const cred of tempCreds) {
        if (await verifyGatewayKey(cred.keyHash, token)) {
          tempCred = cred;
          tempValid = true;
          break;
        }
      }

      if (tempValid && tempCred) {
        // Check expiry
        if (tempCred.expiresAt && new Date() > new Date(tempCred.expiresAt)) {
          return reply.status(401).send({ error: 'Unauthorized', message: 'Temporary key expired' });
        }
        // Check request limit
        if (tempCred.maxRequests && tempCred.requestCount >= tempCred.maxRequests) {
          return reply.status(401).send({ error: 'Unauthorized', message: 'Temporary key request limit reached' });
        }
        // Increment request count
        await db
          .update(gatewayCredentials)
          .set({ requestCount: tempCred.requestCount + 1, updatedAt: new Date() })
          .where(eq(gatewayCredentials.id, tempCred.id));
      } else {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid gateway key' });
      }
    }

    if (setting.ipAllowlist.trim()) {
      const clientIp = getClientIp(request);
      if (!isIpAllowed(clientIp, setting.ipAllowlist)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'IP not allowed' });
      }
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/admin/')) return;
    if (request.url === '/admin/login') return;

    const sessionToken = request.cookies[SESSION_COOKIE];
    if (!sessionToken) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const session = await db.query.adminSessions.findFirst({
      where: eq(adminSessions.tokenHash, sessionToken),
    });

    if (!session || new Date() > new Date(session.expiresAt)) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Session expired' });
    }

    const csrfToken = (request.headers[CSRF_HEADER] as string | undefined) ?? (request.headers['x-csrf-token'] as string | undefined);
    if (request.method !== 'GET' && request.method !== 'HEAD' && csrfToken !== sessionToken) {
      request.log.warn({ csrfToken, sessionToken: sessionToken.slice(0, 8) + '...' }, 'CSRF token mismatch');
      return reply.status(403).send({ error: 'Forbidden', message: 'Invalid CSRF token' });
    }

    request.adminSession = { isAdmin: true };
  });

  app.post('/admin/login', {
    config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    handler: async (request, reply) => {
      const { password } = request.body as { password: string };
      const setting = await db.query.settings.findFirst();
      if (!setting) {
        return reply.status(500).send({ error: 'Server Error' });
      }

      const valid = await verifyPassword(setting.adminPasswordHash, password);
      if (!valid) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid password' });
      }

      const token = generateSecureToken(32);
      const expiresAt = new Date(Date.now() + config.sessionMaxAgeSeconds * 1000);

      await db.insert(adminSessions).values({
        id: crypto.randomUUID(),
        tokenHash: token,
        expiresAt,
        createdAt: new Date(),
      });

      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: 'lax',
        path: '/',
        maxAge: config.sessionMaxAgeSeconds,
      });

      return { success: true, csrfToken: token };
    },
  });

  app.post('/admin/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      await db.delete(adminSessions).where(eq(adminSessions.tokenHash, token));
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { success: true };
  });

  app.get('/admin/me', async (request, reply) => {
    if (!request.adminSession) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    return { authenticated: true, csrfToken: request.cookies[SESSION_COOKIE] };
  });

  app.post('/admin/change-password', async (request, reply) => {
    if (!request.adminSession) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const { currentPassword, newPassword } = request.body as { currentPassword: string; newPassword: string };
    const setting = await db.query.settings.findFirst();
    if (!setting) return reply.status(500).send({ error: 'Server Error' });

    const valid = await verifyPassword(setting.adminPasswordHash, currentPassword);
    if (!valid) return reply.status(401).send({ error: 'Unauthorized', message: 'Current password is incorrect' });

    await db
      .update(settings)
      .set({ adminPasswordHash: await hashPassword(newPassword), updatedAt: new Date() })
      .where(eq(settings.id, 'default'));

    await db.delete(adminSessions).where(eq(adminSessions.tokenHash, request.cookies[SESSION_COOKIE] || ''));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { success: true };
  });

  app.post('/admin/rotate-gateway-key', async (request, reply) => {
    if (!request.adminSession) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const newKey = `mimo_${generateSecureToken(32)}`;
    await db
      .update(settings)
      .set({ gatewayKeyHash: await hashGatewayKey(newKey), updatedAt: new Date() })
      .where(eq(settings.id, 'default'));
    return { key: newKey };
  });
}

export { isIpAllowed, parseAllowlist };
