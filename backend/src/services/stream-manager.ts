import type { FastifyReply } from 'fastify';

export type StreamEventType =
  | 'connected'
  | 'ping'
  | 'request_started'
  | 'key_selected'
  | 'upstream_sent'
  | 'upstream_response'
  | 'streaming_started'
  | 'streaming_completed'
  | 'key_failed'
  | 'failover_attempted'
  | 'request_completed';

export interface StreamEvent {
  type: StreamEventType;
  requestId?: string;
  keyId?: string;
  label?: string;
  model?: string;
  tokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
  success?: boolean;
  statusCode?: number;
  errorMessage?: string;
  errorCode?: number;
  keyStatus?: string;
  streaming?: boolean;
  attempt?: number;
  fallback?: boolean;
  timestamp: number;
}

export class StreamManager {
  private clients: Set<FastifyReply> = new Set();

  addClient(reply: FastifyReply) {
    this.clients.add(reply);

    // Keep-alive ping
    const interval = setInterval(() => {
      this.sendToClient(reply, { type: 'ping', timestamp: Date.now() });
    }, 15000);

    reply.raw.on('close', () => {
      clearInterval(interval);
      this.clients.delete(reply);
    });
  }

  broadcast(event: StreamEvent) {
    for (const client of this.clients) {
      this.sendToClient(client, event);
    }
  }

  private sendToClient(reply: FastifyReply, event: StreamEvent) {
    try {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      this.clients.delete(reply);
    }
  }
}

export const streamManager = new StreamManager();
