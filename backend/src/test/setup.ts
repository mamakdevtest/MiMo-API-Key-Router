process.env.INITIAL_ADMIN_PASSWORD = 'test-admin-password';
process.env.GATEWAY_KEY = 'test-gateway-key-at-least-32-characters-long';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = ':memory:';
process.env.TRUST_PROXY = 'false';

import { beforeAll } from 'vitest';

beforeAll(() => {
  // env vars already set above
});
