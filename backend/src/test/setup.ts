process.env.APP_ENCRYPTION_KEY = 'test-encryption-key-32-chars-long!!';
process.env.INITIAL_ADMIN_PASSWORD = 'test-admin-password';
process.env.SESSION_SECRET = 'test-session-secret-32-chars-long!!';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = ':memory:';
process.env.TRUST_PROXY = 'false';

import { beforeAll } from 'vitest';

beforeAll(() => {
  // env vars already set above
});
