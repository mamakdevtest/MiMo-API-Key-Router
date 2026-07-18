import { describe, it, expect } from 'vitest';
import { OpenAICompatibleAdapter } from '../providers/adapters/openai-compatible.adapter.js';
import type { ProviderInstance, DecryptedProviderCredential, CanonicalRequest } from '../providers/types.js';

function makeProvider(overrides: Partial<ProviderInstance> = {}): ProviderInstance {
  return {
    id: 'p1',
    type: 'openai_compatible',
    name: 'Custom',
    slug: 'custom-main',
    baseUrl: 'https://llm.example.com/v1',
    enabled: true,
    priority: 0,
    routingWeight: 1,
    healthStatus: 'unknown',
    healthMessage: null,
    configJson: null,
    billingMode: 'unknown',
    lastHealthCheckAt: null,
    documentationUrl: null,
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    modelsEndpoint: '/models',
    chatCompletionsEndpoint: '/chat/completions',
    embeddingsEndpoint: null,
    customHeadersJson: null,
    timeoutMs: null,
    healthCheckEndpoint: null,
    capabilitiesJson: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const credential: DecryptedProviderCredential = {
  id: 'c1',
  providerId: 'p1',
  name: 'Default',
  secret: 'sk-custom',
  maskedSecret: 'sk-****stom',
  priority: 0,
  status: 'active',
};

function makeCanonical(overrides: Partial<CanonicalRequest> = {}): CanonicalRequest {
  return {
    model: 'some-model',
    messages: [{ role: 'user', content: 'hi' }],
    ...overrides,
  };
}

describe('OpenAICompatibleAdapter', () => {
  const adapter = new OpenAICompatibleAdapter();

  it('has conservative default capabilities', () => {
    expect(adapter.capabilities.supportsChat).toBe(true);
    expect(adapter.capabilities.supportsTools).toBe(false);
    expect(adapter.capabilities.supportsVision).toBe(false);
    expect(adapter.capabilities.supportsStreaming).toBe(true);
  });

  it('validateConfig rejects missing/invalid baseUrl', async () => {
    expect((await adapter.validateConfig({ baseUrl: '' })).valid).toBe(false);
    expect((await adapter.validateConfig({ baseUrl: 'example.com' })).valid).toBe(false);
    expect((await adapter.validateConfig({ baseUrl: 'https://llm.example.com/v1' })).valid).toBe(true);
  });

  it('builds request using provider-configured endpoints', async () => {
    const provider = makeProvider({
      baseUrl: 'https://llm.example.com/api',
      chatCompletionsEndpoint: '/v2/chat',
    });
    const req = await adapter.buildUpstreamRequest({
      provider,
      credential,
      canonicalRequest: makeCanonical(),
      ingressProtocol: 'openai',
      routeId: null,
      routeTargetId: null,
    });
    expect(req.url).toBe('https://llm.example.com/api/v2/chat');
  });

  it('uses custom auth header and prefix', async () => {
    const provider = makeProvider({ authHeader: 'X-Token', authPrefix: 'Token ' });
    const req = await adapter.buildUpstreamRequest({
      provider,
      credential,
      canonicalRequest: makeCanonical(),
      ingressProtocol: 'openai',
      routeId: null,
      routeTargetId: null,
    });
    expect(req.headers['X-Token']).toBe('Token sk-custom');
  });

  it('omits tools when capabilities do not include tools', async () => {
    const provider = makeProvider({ capabilitiesJson: JSON.stringify({ supportsTools: false }) });
    const req = await adapter.buildUpstreamRequest({
      provider,
      credential,
      canonicalRequest: makeCanonical({
        tools: [{ type: 'function', function: { name: 'f', description: '', parameters: {} } }],
      }),
      ingressProtocol: 'openai',
      routeId: null,
      routeTargetId: null,
    });
    expect(JSON.parse(req.body!).tools).toBeUndefined();
  });

  it('includes tools when capabilities enable them', async () => {
    const provider = makeProvider({ capabilitiesJson: JSON.stringify({ supportsTools: true }) });
    const req = await adapter.buildUpstreamRequest({
      provider,
      credential,
      canonicalRequest: makeCanonical({
        tools: [{ type: 'function', function: { name: 'f', description: '', parameters: {} } }],
        toolChoice: 'auto',
      }),
      ingressProtocol: 'openai',
      routeId: null,
      routeTargetId: null,
    });
    const body = JSON.parse(req.body!);
    expect(body.tools).toHaveLength(1);
    expect(body.tool_choice).toBe('auto');
  });

  it('maps responseFormat json_object', async () => {
    const provider = makeProvider();
    const req = await adapter.buildUpstreamRequest({
      provider,
      credential,
      canonicalRequest: makeCanonical({ responseFormat: { type: 'json_object' } }),
      ingressProtocol: 'openai',
      routeId: null,
      routeTargetId: null,
    });
    expect(JSON.parse(req.body!).response_format).toEqual({ type: 'json_object' });
  });
});
