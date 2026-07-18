import * as dotenv from 'dotenv';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  APP_NAME: z.string().default('AI Provider Router'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.string().default('4000').transform(Number),
  DATABASE_URL: z.string().default('file:./data.sqlite'),
  INITIAL_ADMIN_PASSWORD: z.string().min(1).optional(),
  GATEWAY_KEY: z.string().min(32, 'GATEWAY_KEY must be at least 32 characters'),
  TRUST_PROXY: z.string().default('false').transform((v) => v === 'true'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  SESSION_MAX_AGE_SECONDS: z.string().default('86400').transform(Number),
  COOKIE_SECURE: z.string().default('false').transform((v) => v === 'true'),
  MIMO_OPENAI_BASE_URL: z.string().url().default('https://api.xiaomimimo.com/v1'),
  MIMO_ANTHROPIC_BASE_URL: z.string().url().default('https://api.xiaomimimo.com/anthropic'),
  MIMO_AUTH_HEADER: z.string().default('Authorization'),
  MIMO_AUTH_PREFIX: z.string().default('Bearer '),
  ALLOW_PRIVATE_PROVIDER_URLS: z.string().default('false').transform((v) => v === 'true'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

const raw = parsed.data;

// One stable router key is the only deployment secret. Derive a separate
// credential-encryption key so the router API key itself is never used as an
// AES key. Keep GATEWAY_KEY stable while provider credentials are stored.
const credentialEncryptionKey = crypto
  .createHmac('sha256', raw.GATEWAY_KEY)
  .update('api-router/provider-credentials/v1')
  .digest('hex');

const configuredDatabasePath = raw.DATABASE_URL.startsWith('file:')
  ? raw.DATABASE_URL.replace('file:', '')
  : raw.DATABASE_URL;
const legacyDatabasePath = path.join(path.dirname(configuredDatabasePath), 'mimo-router.sqlite');
// A renamed default must not silently abandon an existing SQLite deployment.
// Explicit custom DATABASE_URL values are always respected.
const databasePath = path.basename(configuredDatabasePath) === 'api-router.sqlite'
  && !fs.existsSync(configuredDatabasePath)
  && fs.existsSync(legacyDatabasePath)
  ? legacyDatabasePath
  : configuredDatabasePath;

export const config = {
  appName: raw.APP_NAME,
  nodeEnv: raw.NODE_ENV,
  host: raw.HOST,
  port: raw.PORT,
  databaseUrl: databasePath,
  dataDir: path.dirname(databasePath),
  encryptionKey: credentialEncryptionKey,
  initialAdminPassword: raw.INITIAL_ADMIN_PASSWORD,
  gatewayKey: raw.GATEWAY_KEY,
  trustProxy: raw.TRUST_PROXY,
  logLevel: raw.LOG_LEVEL,
  sessionMaxAgeSeconds: raw.SESSION_MAX_AGE_SECONDS,
  cookieSecure: raw.COOKIE_SECURE,
  mimoOpenAIBaseUrl: raw.MIMO_OPENAI_BASE_URL,
  mimoAnthropicBaseUrl: raw.MIMO_ANTHROPIC_BASE_URL,
  mimoAuthHeader: raw.MIMO_AUTH_HEADER,
  mimoAuthPrefix: raw.MIMO_AUTH_PREFIX,
  allowPrivateProviderUrls: raw.ALLOW_PRIVATE_PROVIDER_URLS,
} as const;

export type Config = typeof config;
