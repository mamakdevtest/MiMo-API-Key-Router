/**
 * Featherless concurrency monitor.
 * Maintains a single SSE connection to /account/concurrency/stream
 * and broadcasts concurrency data to dashboard clients.
 */

import { streamManager } from './stream-manager.js';
import { ProviderService } from '../providers/provider-service.js';
import type { Db } from '../db/index.js';

export interface ConcurrencyState {
  providerId: string;
  limit: number | null;
  usedCost: number;
  requestCount: number;
  requests: Array<{
    id: string;
    cost: number;
    model: string;
    startedAt: number;
    durationMs: number;
  }>;
  lastUpdated: Date;
}

export class ConcurrencyMonitor {
  private providerService: ProviderService;
  private connections = new Map<string, { controller: AbortController; active: boolean }>();
  private state = new Map<string, ConcurrencyState>();

  constructor(private db: Db) {
    this.providerService = new ProviderService(db);
  }

  async startAll(): Promise<void> {
    const providers = await this.providerService.list();
    for (const provider of providers) {
      if (!provider.enabled || provider.type !== 'featherless') continue;
      await this.startMonitoring(provider.id);
    }
  }

  async startMonitoring(providerId: string): Promise<void> {
    if (this.connections.has(providerId)) return;

    const provider = await this.providerService.getById(providerId);
    if (!provider || provider.type !== 'featherless') return;

    const credential = await this.providerService.selectCredential(providerId);
    if (!credential) return;

    const baseUrl = provider.baseUrl || 'https://api.featherless.ai';
    const url = new URL('/account/concurrency/stream', baseUrl).toString();
    const controller = new AbortController();

    this.connections.set(providerId, { controller, active: true });

    const connect = async () => {
      try {
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${credential.secret}` },
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          this.connections.delete(providerId);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                const state: ConcurrencyState = {
                  providerId,
                  limit: data.limit ?? null,
                  usedCost: data.used_cost ?? 0,
                  requestCount: data.request_count ?? 0,
                  requests: (data.requests ?? []).map((r: any) => ({
                    id: r.id,
                    cost: r.cost,
                    model: r.model,
                    startedAt: r.started_at,
                    durationMs: r.duration_ms,
                  })),
                  lastUpdated: new Date(),
                };
                this.state.set(providerId, state);

                streamManager.broadcast({
                  type: 'concurrency_update',
                  requestId: providerId,
                  model: 'concurrency',
                  timestamp: Date.now(),
                } as any);
              } catch { /* ignore parse errors */ }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          // Reconnect after delay
          setTimeout(() => {
            this.connections.delete(providerId);
            this.startMonitoring(providerId);
          }, 30000);
        }
      }
    };

    connect();
  }

  stopMonitoring(providerId: string): void {
    const conn = this.connections.get(providerId);
    if (conn) {
      conn.controller.abort();
      this.connections.delete(providerId);
    }
    this.state.delete(providerId);
  }

  stopAll(): void {
    for (const [id] of this.connections) {
      this.stopMonitoring(id);
    }
  }

  getState(providerId: string): ConcurrencyState | null {
    return this.state.get(providerId) ?? null;
  }

  getAllStates(): ConcurrencyState[] {
    return [...this.state.values()];
  }
}
