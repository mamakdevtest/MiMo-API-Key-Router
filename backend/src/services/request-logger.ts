import { requestLogs } from '../db/schema.js';
import type { Db } from '../db/index.js';

export interface LogEntry {
  requestId: string;
  route: string;
  model?: string | null;
  apiKeyId?: string | null;
  statusCode?: number | null;
  latencyMs: number;
  streaming: boolean;
  fallback: boolean;
  clientIp?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  /** Which attempt this log represents (1-based). Omit for final/only log. */
  attempt?: number;
  /** Error message for failed attempts */
  errorMessage?: string | null;
}

export async function logRequest(db: Db, entry: LogEntry) {
  await db.insert(requestLogs).values({
    id: crypto.randomUUID(),
    requestId: entry.requestId,
    timestamp: new Date(),
    route: entry.route,
    model: entry.model ?? null,
    apiKeyId: entry.apiKeyId ?? null,
    statusCode: entry.statusCode ?? null,
    latencyMs: entry.latencyMs,
    streaming: entry.streaming,
    fallback: entry.fallback,
    clientIp: entry.clientIp ?? null,
    promptTokens: entry.promptTokens ?? 0,
    completionTokens: entry.completionTokens ?? 0,
    totalTokens: entry.totalTokens ?? 0,
    estimatedCost: entry.estimatedCost ?? 0,
  });
}
