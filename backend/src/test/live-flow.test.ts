import { describe, expect, it } from 'vitest';
import { providerCredentials, providers, requestAttempts, requestLogs } from '../db/schema.js';
import { adminLogin, buildTestApp } from './helpers.js';

describe('persistent live request flow', () => {
  it('returns recent request history together with ordered failover attempts', async () => {
    const { app, db } = await buildTestApp();
    const now = new Date();
    await db.insert(providers).values({
      id: 'flow-provider', type: 'openai_compatible', name: 'Flow Provider', slug: 'flow', baseUrl: 'https://example.test/v1',
      enabled: true, priority: 0, routingWeight: 1, healthStatus: 'healthy', billingMode: 'unknown', createdAt: now, updatedAt: now,
    });
    await db.insert(providerCredentials).values({
      id: 'flow-credential', providerId: 'flow-provider', name: 'primary credential', encryptedSecret: 'not-read-in-this-test',
      maskedSecret: 'pri****ial', priority: 0, status: 'active', createdAt: now, updatedAt: now,
    });
    await db.insert(requestLogs).values({
      id: 'flow-log', requestId: 'flow-request', timestamp: now, route: '/v1/chat/completions', model: 'model-a',
      publicModelId: 'flow/model-a', finalProviderId: 'flow-provider', finalCredentialId: 'flow-credential', upstreamModelId: 'model-a',
      statusCode: 200, latencyMs: 245, streaming: false, fallback: true, attemptCount: 2, failoverCount: 1,
      promptTokens: 2, completionTokens: 1, totalTokens: 3, estimatedCost: 0.001,
    });
    await db.insert(requestAttempts).values([
      { id: 'flow-attempt-1', requestLogId: 'flow-log', attemptNumber: 1, providerId: 'flow-provider', credentialId: 'flow-credential', upstreamModelId: 'model-a', startedAt: now, completedAt: now, latencyMs: 80, httpStatus: 429, result: 'error', errorMessage: 'rate limited', retryable: true },
      { id: 'flow-attempt-2', requestLogId: 'flow-log', attemptNumber: 2, providerId: 'flow-provider', credentialId: 'flow-credential', upstreamModelId: 'model-a', startedAt: now, completedAt: now, latencyMs: 165, httpStatus: 200, result: 'success', retryable: false },
    ]);

    const session = await adminLogin(app);
    const response = await app.inject({ method: 'GET', url: '/admin/live-flow?limit=10', cookies: { admin_session: session } });
    expect(response.statusCode).toBe(200);
    const [flow] = JSON.parse(response.payload);
    expect(flow).toMatchObject({ requestId: 'flow-request', providerName: 'Flow Provider', attemptCount: 2, latencyMs: 245 });
    expect(flow.attempts).toHaveLength(2);
    expect(flow.attempts.map((attempt: { attemptNumber: number }) => attempt.attemptNumber)).toEqual([1, 2]);
    expect(flow.attempts[0]).toMatchObject({ credentialName: 'primary credential', result: 'error', httpStatus: 429 });
  });
});
