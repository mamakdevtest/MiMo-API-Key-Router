import { describe, it, expect } from 'vitest';
import { OrcaRouterAdapter } from '../providers/adapters/orcarouter.adapter.js';
import type { ProviderInstance, DecryptedProviderCredential, CanonicalRequest } from '../providers/types.js';

function makeProvider(overrides: Partial<ProviderInstance> = {}): ProviderInstance {
  return {
    id: 'p1',
    type: 'orcarouter',
    name: 'OrcaRouter',
    slug: 'orcarouter-main',
    baseUrl: 'https://api.orcarouter.ai/v1',
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
  secret: 'sk-orca-test',
  maskedSecret: 'sk-****test',
  priority: 0,
  status: 'active',
};

function makeCanonical(overrides: Partial<CanonicalRequest> = {}): CanonicalRequest {
  return {
    model: 'orcarouter/auto',
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides,
  };
}

describe('OrcaRouterAdapter', () => {
  const adapter = new OrcaRouterAdapter();

  it('has the correct type and capabilities', () => {
    expect(adapter.type).toBe('orcarouter');
    expect(adapter.capabilities.supportsChat).toBe(true);
    expect(adapter.capabilities.supportsStreaming).toBe(true);
    expect(adapter.capabilities.supportsTools).toBe(true);
    expect(adapter.capabilities.supportsVision).toBe(true);
  });

  it('validateConfig requires baseUrl', async () => {
    expect((await adapter.validateConfig({ baseUrl: '' })).valid).toBe(false);
    expect((await adapter.validateConfig({ baseUrl: 'https://api.orcarouter.ai/v1' })).valid).toBe(true);
  });

  it('buildUpstreamRequest passes model ID through unchanged', async () => {
    const provider = makeProvider();
    const req = await adapter.buildUpstreamRequest({
      provider,
      credential,
      canonicalRequest: makeCanonical({ model: 'anthropic/claude-sonnet-4.6' }),
      ingressProtocol: 'openai',
      routeId: null,
      routeTargetId: null,
    });

    expect(req.url).toBe('https://api.orcarouter.ai/v1/chat/completions');
    expect(req.method).toBe('POST');
    const body = JSON.parse(req.body!);
    expect(body.model).toBe('anthropic/claude-sonnet-4.6'); // passthrough
  });

  it('buildUpstreamRequest preserves router alias orcarouter/auto', async () => {
    const provider = makeProvider();
    const req = await adapter.buildUpstreamRequest({
      provider,
      credential,
      canonicalRequest: makeCanonical({ model: 'orcarouter/auto' }),
      ingressProtocol: 'openai',
      routeId: null,
      routeTargetId: null,
    });
    expect(JSON.parse(req.body!).model).toBe('orcarouter/auto');
  });

  it('buildUpstreamRequest sets Bearer auth header', async () => {
    const provider = makeProvider();
    const req = await adapter.buildUpstreamRequest({
      provider,
      credential,
      canonicalRequest: makeCanonical(),
      ingressProtocol: 'openai',
      routeId: null,
      routeTargetId: null,
    });
    expect(req.headers['Authorization']).toBe('Bearer sk-orca-test');
  });

  it('respects custom authHeader/authPrefix from provider config', async () => {
    const provider = makeProvider({ authHeader: 'X-API-Key', authPrefix: '' });
    const req = await adapter.buildUpstreamRequest({
      provider,
      credential,
      canonicalRequest: makeCanonical(),
      ingressProtocol: 'openai',
      routeId: null,
      routeTargetId: null,
    });
    expect(req.headers['X-API-Key']).toBe('sk-orca-test');
    expect(req.headers['Authorization']).toBeUndefined();
  });

  it('maps responseFormat json_schema to response_format', async () => {
    const provider = makeProvider();
    const req = await adapter.buildUpstreamRequest({
      provider,
      credential,
      canonicalRequest: makeCanonical({
        responseFormat: { type: 'json_schema', jsonSchema: { name: 'test', schema: {} } },
      }),
      ingressProtocol: 'openai',
      routeId: null,
      routeTargetId: null,
    });
    const body = JSON.parse(req.body!);
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'test', schema: {} } });
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

  it('includes tools and tool_choice in the request', async () => {
    const provider = makeProvider();
    const req = await adapter.buildUpstreamRequest({
      provider,
      credential,
      canonicalRequest: makeCanonical({
        tools: [{ type: 'function', function: { name: 'get_weather', description: '', parameters: {} } }],
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

  it('parseNonStreamingResponse extracts content and usage', async () => {
    const provider = makeProvider();
    const result = await adapter.parseNonStreamingResponse({
      provider,
      credential,
      upstreamResponse: new Response(),
      upstreamBody: {
        id: 'chat-1',
        model: 'orcarouter/auto',
        choices: [{ message: { content: 'hi there', tool_calls: null }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      },
      requestContext: { provider, credential, canonicalRequest: makeCanonical(), ingressProtocol: 'openai', routeId: null, routeTargetId: null },
    });

    expect(result.content).toBe('hi there');
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 3, totalTokens: 8 });
  });

  it('classifyError maps 401 to next_credential', async () => {
    const provider = makeProvider();
    const result = await adapter.classifyError({
      provider,
      credential,
      httpStatus: 401,
      requestContext: { provider, credential, canonicalRequest: makeCanonical(), ingressProtocol: 'openai', routeId: null, routeTargetId: null },
    });
    expect(result.scope).toBe('credential');
    expect(result.action).toBe('next_credential');
    expect(result.retryable).toBe(true);
  });
});
