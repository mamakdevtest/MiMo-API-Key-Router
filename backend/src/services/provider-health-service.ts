/**
 * Provider health monitoring service.
 * Periodically checks provider health and updates status.
 */

import { ProviderService } from '../providers/provider-service.js';
import { getAdapterSafe } from '../providers/registry.js';
import type { Db } from '../db/index.js';
import type { ProviderHealthStatus } from '../providers/types.js';

export class ProviderHealthService {
  private providerService: ProviderService;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private db: Db) {
    this.providerService = new ProviderService(db);
  }

  start(intervalMs = 300_000): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.checkAll(), intervalMs);
    // Run once on start after a short delay
    setTimeout(() => this.checkAll(), 5000);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async checkAll(): Promise<void> {
    try {
      const providers = await this.providerService.list();
      for (const provider of providers) {
        if (!provider.enabled) continue;
        await this.checkProvider(provider.id);
      }
    } catch (err) {
      // Don't crash on health check errors
    }
  }

  async checkProvider(providerId: string): Promise<ProviderHealthStatus> {
    const provider = await this.providerService.getById(providerId);
    if (!provider) return 'unknown';
    if (!provider.enabled) return 'disabled';

    const adapter = getAdapterSafe(provider.type);
    if (!adapter) return 'unknown';

    const credential = await this.providerService.selectCredential(providerId);
    if (!credential) {
      await this.providerService.updateHealth(providerId, 'unavailable', 'No active credentials');
      return 'unavailable';
    }

    try {
      const result = await adapter.testCredential(provider, credential);
      if (result.success) {
        await this.providerService.updateHealth(providerId, 'healthy', 'Connection OK');
        return 'healthy';
      }
      await this.providerService.updateHealth(providerId, 'degraded', result.message);
      return 'degraded';
    } catch (err) {
      await this.providerService.updateHealth(providerId, 'degraded', `Health check failed: ${(err as Error).message}`);
      return 'degraded';
    }
  }
}
