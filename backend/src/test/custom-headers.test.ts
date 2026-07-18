import { describe, it, expect } from 'vitest';
import { serializeCustomHeaders, parseCustomHeaders, maskCustomHeaders } from '../security/custom-headers.js';

describe('custom-headers security', () => {
  it('returns null for empty headers', () => {
    expect(serializeCustomHeaders(null)).toBeNull();
    expect(serializeCustomHeaders({})).toBeNull();
    expect(serializeCustomHeaders(undefined)).toBeNull();
  });

  it('stores non-secret headers in plaintext', () => {
    const json = serializeCustomHeaders({ 'X-Team': 'backend', 'HTTP-Referer': 'https://app.example' })!;
    const parsed = JSON.parse(json);
    expect(parsed['X-Team']).toBe('backend');
    expect(parsed['HTTP-Referer']).toBe('https://app.example');
  });

  it('encrypts secret-looking headers', () => {
    const json = serializeCustomHeaders({
      'Authorization': 'Bearer sk-secret',
      'X-Api-Key': 'key-123',
      'X-Custom-Token': 'tok',
      'X-Normal': 'plain',
    })!;
    const parsed = JSON.parse(json);
    expect(parsed['Authorization']).toMatch(/^enc:v1:/);
    expect(parsed['X-Api-Key']).toMatch(/^enc:v1:/);
    expect(parsed['X-Custom-Token']).toMatch(/^enc:v1:/);
    expect(parsed['X-Normal']).toBe('plain');
  });

  it('round-trips encrypted headers via parseCustomHeaders', () => {
    const original = {
      'Authorization': 'Bearer sk-secret',
      'X-Api-Key': 'key-123',
      'X-Team': 'backend',
    };
    const json = serializeCustomHeaders(original);
    const restored = parseCustomHeaders(json);
    expect(restored).toEqual(original);
  });

  it('maskCustomHeaders hides secrets but shows plaintext', () => {
    const json = serializeCustomHeaders({
      'Authorization': 'Bearer sk-secret',
      'X-Team': 'backend',
    });
    const masked = maskCustomHeaders(json);
    expect(masked['Authorization']).toBe('****');
    expect(masked['X-Team']).toBe('backend');
  });

  it('parseCustomHeaders tolerates invalid JSON', () => {
    expect(parseCustomHeaders('not json')).toEqual({});
    expect(parseCustomHeaders(null)).toEqual({});
  });
});
