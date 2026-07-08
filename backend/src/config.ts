import * as dotenv from 'dotenv';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.string().default('4000').transform(Number),
  DATABASE_URL: z.string().default('file:./data.sqlite'),
  APP_ENCRYPTION_KEY: z.string().min(32),
  INITIAL_ADMIN_PASSWORD: z.string().min(1).optional(),
  GATEWAY_KEY: z.string().min(8).optional(),
  TRUST_PROXY: z.string().default('false').transform((v) => v === 'true'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  SESSION_SECRET: z.string().min(32).default(() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET is required in production');
    }
    return 'dev-session-secret-change-me-in-production';
  }),
  SESSION_MAX_AGE_SECONDS: z.string().default('86400').transform(Number),
  COOKIE_SECURE: z.string().default('false').transform((v) => v === 'true'),
  MIMO_OPENAI_BASE_URL: z.string().url().default('https://api.xiaomimimo.com/v1'),
  MIMO_ANTHROPIC_BASE_URL: z.string().url().default('https://api.xiaomimimo.com/anthropic'),
  MIMO_AUTH_HEADER: z.string().default('Authorization'),
  MIMO_AUTH_PREFIX: z.string().default('Bearer '),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

const raw = parsed.data;

export const config = {
  nodeEnv: raw.NODE_ENV,
  host: raw.HOST,
  port: raw.PORT,
  databaseUrl: raw.DATABASE_URL.startsWith('file:')
    ? raw.DATABASE_URL.replace('file:', '')
    : raw.DATABASE_URL,
  dataDir: path.dirname(raw.DATABASE_URL.replace('file:', '')),
  encryptionKey: raw.APP_ENCRYPTION_KEY,
  initialAdminPassword: raw.INITIAL_ADMIN_PASSWORD,
  gatewayKey: raw.GATEWAY_KEY,
  trustProxy: raw.TRUST_PROXY,
  logLevel: raw.LOG_LEVEL,
  sessionSecret: raw.SESSION_SECRET,
  sessionMaxAgeSeconds: raw.SESSION_MAX_AGE_SECONDS,
  cookieSecure: raw.COOKIE_SECURE,
  mimoOpenAIBaseUrl: raw.MIMO_OPENAI_BASE_URL,
  mimoAnthropicBaseUrl: raw.MIMO_ANTHROPIC_BASE_URL,
  mimoAuthHeader: raw.MIMO_AUTH_HEADER,
  mimoAuthPrefix: raw.MIMO_AUTH_PREFIX,
} as const;

export type Config = typeof config;
