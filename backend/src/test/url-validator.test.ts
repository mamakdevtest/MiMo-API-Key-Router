import { describe, it, expect } from 'vitest';
import { validateProviderUrl } from '../security/url-validator.js';

// NODE_ENV=test → http:// and private IPs are allowed (local dev escape hatch).
// We test the production-guard logic by checking protocol rules and safe public URLs.

describe('validateProviderUrl', () => {
  it('rejects invalid URLs', async () => {
    const result = await validateProviderUrl('not-a-url');
    expect(result.safe).toBe(false);
    expect(result.error).toMatch(/invalid/i);
  });

  it('rejects unsupported protocols', async () => {
    const result = await validateProviderUrl('ftp://example.com');
    expect(result.safe).toBe(false);
    expect(result.error).toMatch(/protocol/i);
  });

  it('rejects file:// URLs', async () => {
    const result = await validateProviderUrl('file:///etc/passwd');
    expect(result.safe).toBe(false);
  });

  it('blocks the cloud metadata hostname', async () => {
    const result = await validateProviderUrl('https://metadata.google.internal/latest');
    expect(result.safe).toBe(false);
    expect(result.error).toMatch(/not allowed/i);
  });

  it('allows http:// in test/development environment', async () => {
    // NODE_ENV=test (set in setup.ts) → http allowed
    const result = await validateProviderUrl('http://example.com/v1');
    expect(result.safe).toBe(true);
  });

  it('allows https:// public URLs', async () => {
    const result = await validateProviderUrl('https://api.orcarouter.ai/v1');
    expect(result.safe).toBe(true);
  });

  it('allows private IPs in test/development environment', async () => {
    const result = await validateProviderUrl('http://127.0.0.1:8080/v1');
    expect(result.safe).toBe(true); // allowed because NODE_ENV=test
  });

  it('allows RFC1918 hostnames in test/development', async () => {
    const result = await validateProviderUrl('http://192.168.1.10:3000');
    expect(result.safe).toBe(true);
  });
});
