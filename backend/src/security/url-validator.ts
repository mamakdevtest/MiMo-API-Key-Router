/**
 * SSRF protection for custom provider URLs.
 * Validates that a provider base URL does not resolve to private/loopback/reserved IPs.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from '../config.js';

export interface UrlValidationResult {
  safe: boolean;
  error?: string;
  resolvedIps?: string[];
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  // 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8 (loopback), 169.254.0.0/16 (link-local),
  // 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10 (CGNAT), 192.0.0.0/24, 224.0.0.0/4 (multicast), 240.0.0.0/4
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  // loopback, unspecified, link-local, unique-local, ipv4-mapped private
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice(7);
    if (isIP(mapped) === 4) return isPrivateIPv4(mapped);
  }
  return false;
}

function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // unparseable → treat as unsafe
}

/**
 * Validate that a provider base URL is safe to connect to (no SSRF to private networks).
 * Resolves the hostname and checks every resolved IP.
 */
export async function validateProviderUrl(rawUrl: string): Promise<UrlValidationResult> {
  // Local development escape hatch
  if (config.allowPrivateProviderUrls) {
    return { safe: true };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { safe: false, error: 'Invalid URL' };
  }

  const isLocalEnv = config.nodeEnv === 'development' || config.nodeEnv === 'test';

  if (url.protocol === 'http:') {
    if (!isLocalEnv) {
      return { safe: false, error: 'Only https:// URLs are allowed in production' };
    }
  } else if (url.protocol !== 'https:') {
    return { safe: false, error: `Unsupported protocol: ${url.protocol}` };
  }

  const hostname = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { safe: false, error: 'This hostname is not allowed' };
  }

  // If the hostname is a literal IP, check it directly
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      if (isLocalEnv) return { safe: true, resolvedIps: [hostname] };
      return { safe: false, error: 'Private/loopback IP addresses are not allowed' };
    }
    return { safe: true, resolvedIps: [hostname] };
  }

  // Resolve DNS and check all returned IPs
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch (err) {
    return { safe: false, error: `DNS resolution failed: ${(err as Error).message}` };
  }

  if (addresses.length === 0) {
    return { safe: false, error: 'DNS resolution returned no addresses' };
  }

  const ips = addresses.map((a) => a.address);
  for (const ip of ips) {
    if (isPrivateIp(ip)) {
      if (isLocalEnv) return { safe: true, resolvedIps: ips };
      return { safe: false, error: `Hostname resolves to a private/loopback address (${ip})`, resolvedIps: ips };
    }
  }

  return { safe: true, resolvedIps: ips };
}
