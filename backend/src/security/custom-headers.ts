/**
 * Custom provider headers storage.
 * Secret-looking header values are encrypted at rest; the rest are stored as-is.
 * The whole map is serialized to JSON for the providers.custom_headers_json column.
 */

import { encrypt, decrypt } from '../crypto/index.js';
import { config } from '../config.js';

const SECRET_PATTERN = /authorization|api[-_]?key|x-api-key|token|secret|password/i;
const ENCRYPTED_PREFIX = 'enc:v1:';

function isSecretHeader(name: string): boolean {
  return SECRET_PATTERN.test(name);
}

/**
 * Serialize a custom-headers map for storage.
 * Secret values are AES-256-GCM encrypted and prefixed so they can be detected on read.
 */
export function serializeCustomHeaders(headers: Record<string, string> | null | undefined): string | null {
  if (!headers || Object.keys(headers).length === 0) return null;

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!key || value === undefined || value === null) continue;
    if (isSecretHeader(key)) {
      out[key] = ENCRYPTED_PREFIX + encrypt(String(value), config.encryptionKey);
    } else {
      out[key] = String(value);
    }
  }
  return JSON.stringify(out);
}

/**
 * Parse a stored custom-headers JSON string back into a plaintext map.
 * Encrypted values are transparently decrypted.
 */
export function parseCustomHeaders(storedJson: string | null | undefined): Record<string, string> {
  if (!storedJson) return {};
  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(storedJson);
  } catch {
    return {};
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') continue;
    if (value.startsWith(ENCRYPTED_PREFIX)) {
      try {
        out[key] = decrypt(value.slice(ENCRYPTED_PREFIX.length), config.encryptionKey);
      } catch {
        // Skip values that fail to decrypt (wrong key, corrupted)
        continue;
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Mask secret header values for safe display in API responses.
 */
export function maskCustomHeaders(storedJson: string | null | undefined): Record<string, string> {
  const headers = parseCustomHeaders(storedJson);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = isSecretHeader(key) ? '****' : value;
  }
  return out;
}
