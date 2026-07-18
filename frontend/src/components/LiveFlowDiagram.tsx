import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowRight, Bot, CheckCircle2, Clock3, KeyRound, Radio, Server, XCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

type FlowMode = 'gateway' | 'benchmark';

interface StreamEvent {
  type: string;
  flowType?: FlowMode;
  requestId?: string;
  label?: string;
  model?: string;
  providerName?: string;
  tokens?: number;
  cost?: number;
  success?: boolean;
  statusCode?: number;
  errorMessage?: string;
  keyStatus?: string;
  streaming?: boolean;
  attempt?: number;
  latencyMs?: number | null;
  timestamp: number;
}

interface RequestFlow {
  requestId: string;
  model: string;
  providerName?: string;
  events: StreamEvent[];
  status: 'pending' | 'success' | 'failed';
  totalTokens: number;
  cost: number;
  streaming: boolean;
  attempts: number;
  latencyMs: number | null;
  persisted?: boolean;
}

const EVENT_STYLE: Record<string, { label: string; color: string }> = {
  request_started: { label: 'Request received', color: 'text-blue-400' },
  benchmark_started: { label: 'Test started', color: 'text-blue-400' },
  key_selected: { label: 'Credential selected', color: 'text-cyan-400' },
  upstream_sent: { label: 'Sent upstream', color: 'text-indigo-400' },
  upstream_response: { label: 'Upstream responded', color: 'text-violet-400' },
  key_failed: { label: 'Attempt failed', color: 'text-red-400' },
  failover_attempted: { label: 'Failover', color: 'text-amber-400' },
  request_completed: { label: 'Completed', color: 'text-emerald-400' },
  benchmark_completed: { label: 'Test completed', color: 'text-emerald-400' },
};

function eventIcon(type: string) {
  if (type === 'key_selected') return KeyRound;
  if (type === 'key_failed') return XCircle;
  if (type === 'request_completed' || type === 'benchmark_completed') return CheckCircle2;
  if (type === 'upstream_response') return Server;
  return Activity;
}

function eventTime(iso: string) {
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? Date.now() : value;
}

function historicFlow(record: Awaited<ReturnType<typeof api.liveFlow.list>>[number]): RequestFlow {
  const baseTime = eventTime(record.timestamp);
  const succeeded = record.statusCode !== null && record.statusCode >= 200 && record.statusCode < 300;
  const events: StreamEvent[] = [{
    type: 'request_started', requestId: record.requestId, model: record.model ?? record.upstreamModelId ?? 'unknown',
    providerName: record.providerName ?? undefined, streaming: record.streaming, timestamp: baseTime,
  }];

  for (const attempt of record.attempts) {
    events.push({
      type: 'key_selected', requestId: record.requestId, label: attempt.credentialName ?? 'Credential',
      providerName: attempt.providerName ?? undefined, model: record.model ?? attempt.upstreamModelId ?? 'unknown',
      attempt: attempt.attemptNumber, timestamp: eventTime(attempt.startedAt),
    });
    events.push({
      type: attempt.result === 'success' ? 'upstream_response' : 'key_failed', requestId: record.requestId,
      label: attempt.credentialName ?? undefined, providerName: attempt.providerName ?? undefined,
      model: record.model ?? attempt.upstreamModelId ?? 'unknown', attempt: attempt.attemptNumber,
      statusCode: attempt.httpStatus ?? undefined, latencyMs: attempt.latencyMs,
      errorMessage: attempt.errorMessage ?? undefined, success: attempt.result === 'success',
      timestamp: attempt.completedAt ? eventTime(attempt.completedAt) : baseTime,
    });
  }
  events.push({
    type: 'request_completed', requestId: record.requestId, model: record.model ?? record.upstreamModelId ?? 'unknown',
    providerName: record.providerName ?? undefined, statusCode: record.statusCode ?? undefined, success: succeeded,
    latencyMs: record.latencyMs, tokens: record.totalTokens ?? 0, cost: record.estimatedCost ?? 0,
    timestamp: baseTime + 1,
  });

  return {
    requestId: record.requestId,
    model: record.model ?? record.upstreamModelId ?? 'unknown',
    providerName: record.providerName ?? undefined,
    events,
    status: succeeded ? 'success' : 'failed',
    totalTokens: record.totalTokens ?? 0,
    cost: record.estimatedCost ?? 0,
    streaming: record.streaming,
    attempts: record.attemptCount ?? (record.attempts.length || 1),
    latencyMs: record.latencyMs,
    persisted: true,
  };
}

export function LiveFlowDiagram({ mode = 'gateway', title }: { mode?: FlowMode; title?: string }) {
  const [flows, setFlows] = useState<RequestFlow[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<StreamEvent | null>(null);
  const activeTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const history = useQuery({
    queryKey: ['live-flow', mode],
    queryFn: () => api.liveFlow.list(20),
    enabled: mode === 'gateway',
    retry: false,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!history.data || mode !== 'gateway') return;
    const restored = history.data.map(historicFlow);
    setFlows((current) => {
      const live = current.filter((flow) => !flow.persisted);
      const merged = [...live, ...restored.filter((stored) => !live.some((flow) => flow.requestId === stored.requestId))];
      return merged.sort((a, b) => b.events[0].timestamp - a.events[0].timestamp).slice(0, 20);
    });
  }, [history.data, mode]);

  useEffect(() => {
    const sse = new EventSource('/admin/stream');
    sse.onopen = () => setConnected(true);
    sse.onerror = () => setConnected(false);
    sse.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as StreamEvent;
        if (event.type === 'connected' || event.type === 'ping' || (event.flowType ?? 'gateway') !== mode || !event.requestId) return;
        setLastEvent(event);
        const timer = setTimeout(() => setLastEvent(null), 1_500);
        activeTimers.current.push(timer);
        setFlows((current) => {
          const index = current.findIndex((flow) => flow.requestId === event.requestId);
          if (index < 0) {
            const newFlow: RequestFlow = {
              requestId: event.requestId!, model: event.model ?? 'unknown', providerName: event.providerName,
              events: [event], status: 'pending', totalTokens: 0, cost: 0, streaming: event.streaming ?? false,
              attempts: event.attempt ?? 1, latencyMs: null,
            };
            return [newFlow, ...current].slice(0, 20);
          }
          const updated = [...current];
          const flow = { ...updated[index], events: [...updated[index].events, event], persisted: false };
          flow.model = event.model ?? flow.model;
          flow.providerName = event.providerName ?? flow.providerName;
          flow.attempts = Math.max(flow.attempts, event.attempt ?? 1);
          if (event.latencyMs !== undefined) flow.latencyMs = event.latencyMs;
          if (event.type === 'request_completed' || event.type === 'benchmark_completed') {
            flow.status = event.success ? 'success' : 'failed';
            flow.totalTokens = event.tokens ?? flow.totalTokens;
            flow.cost = event.cost ?? flow.cost;
          }
          updated.splice(index, 1);
          return [flow, ...updated].slice(0, 20);
        });
      } catch {
        // Ignore malformed SSE payloads; the next event remains usable.
      }
    };
    return () => {
      sse.close();
      activeTimers.current.forEach(clearTimeout);
      activeTimers.current = [];
      setConnected(false);
    };
  }, [mode]);

  const latest = flows[0];
  const summary = useMemo(() => {
    const completed = flows.filter((flow) => flow.status !== 'pending');
    const successful = completed.filter((flow) => flow.status === 'success').length;
    const latencies = completed.map((flow) => flow.latencyMs).filter((value): value is number => value !== null);
    return {
      completed: completed.length,
      successful,
      active: flows.filter((flow) => flow.status === 'pending').length,
      averageLatency: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
    };
  }, [flows]);
  const heading = title ?? (mode === 'benchmark' ? 'Live Model Test Flow' : 'Live Request Flow');

  return (
    <Card className="overflow-hidden border border-border/80 bg-card/80 shadow-sm">
      <CardHeader className="border-b bg-muted/20 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg"><Activity className="h-5 w-5 text-primary" />{heading}</CardTitle>
            <CardDescription className="mt-1">
              {mode === 'gateway' ? 'Recent requests are restored from SQLite after a deployment; new requests stream in live.' : 'Each model test shows its selected credential and final availability result as it runs.'}
            </CardDescription>
          </div>
          <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs ${connected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
            <Radio className="h-3.5 w-3.5" />{connected ? 'Live connected' : 'Reconnecting'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Completed" value={String(summary.completed)} />
          <Stat label="Successful" value={String(summary.successful)} tone="success" />
          <Stat label="Active" value={String(summary.active)} tone={summary.active ? 'info' : undefined} />
          <Stat label="Avg latency" value={summary.averageLatency === null ? '—' : `${summary.averageLatency} ms`} />
        </div>

        <div className="grid items-center gap-3 rounded-xl border bg-muted/20 p-4 text-center md:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <FlowNode icon={<Server className="h-5 w-5" />} label={mode === 'benchmark' ? 'Benchmark' : 'Client'} active={!!lastEvent} />
          <ArrowRight className="mx-auto hidden h-4 w-4 text-muted-foreground md:block" />
          <FlowNode icon={<Activity className="h-5 w-5" />} label="API Router" active={!!lastEvent} />
          <ArrowRight className="mx-auto hidden h-4 w-4 text-muted-foreground md:block" />
          <FlowNode icon={<Bot className="h-5 w-5" />} label={latest?.providerName ?? latest?.model ?? 'Provider'} active={!!lastEvent} />
        </div>

        {flows.length ? (
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {flows.slice(0, 10).map((flow) => <FlowRow key={flow.requestId} flow={flow} />)}
          </div>
        ) : (
          <div className="flex min-h-28 items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground"><Clock3 className="h-4 w-4" />Waiting for {mode === 'benchmark' ? 'a model test' : 'a request'}…</div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'info' }) {
  return <div className="rounded-lg border bg-background/60 p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className={`mt-1 text-lg font-semibold ${tone === 'success' ? 'text-emerald-400' : tone === 'info' ? 'text-blue-400' : ''}`}>{value}</p></div>;
}

function FlowNode({ icon, label, active }: { icon: React.ReactNode; label: string; active: boolean }) {
  return <motion.div animate={{ scale: active ? 1.02 : 1 }} className="flex min-w-0 items-center justify-center gap-2 text-sm font-medium"><span className={`rounded-lg border p-2 ${active ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground'}`}>{icon}</span><span className="truncate">{label}</span></motion.div>;
}

function FlowRow({ flow }: { flow: RequestFlow }) {
  const failed = flow.status === 'failed';
  const StatusIcon = failed ? XCircle : flow.status === 'success' ? CheckCircle2 : AlertTriangle;
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border bg-background/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0"><div className="flex items-center gap-2"><StatusIcon className={`h-4 w-4 shrink-0 ${failed ? 'text-red-400' : flow.status === 'success' ? 'text-emerald-400' : 'text-amber-400'}`} /><p className="truncate font-mono text-xs font-medium">{flow.model}</p></div><p className="mt-1 text-xs text-muted-foreground">{flow.providerName ?? 'Provider pending'} · {flow.attempts} attempt{flow.attempts === 1 ? '' : 's'} · {flow.latencyMs === null ? 'latency pending' : `${flow.latencyMs} ms`}</p></div>
        <div className="text-right text-xs text-muted-foreground"><p>{flow.totalTokens ? `${flow.totalTokens.toLocaleString()} tokens` : '— tokens'}</p><p>{flow.events[0] ? new Date(flow.events[0].timestamp).toLocaleTimeString() : ''}</p></div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {flow.events.map((event, index) => {
          const descriptor = EVENT_STYLE[event.type] ?? { label: event.type, color: 'text-muted-foreground' };
          const Icon = eventIcon(event.type);
          return <div key={`${event.type}-${event.timestamp}-${index}`} className="flex items-center gap-1"><span title={event.errorMessage || descriptor.label} className="inline-flex max-w-48 items-center gap-1 rounded-md bg-muted px-1.5 py-1 text-[10px]"><Icon className={`h-3 w-3 shrink-0 ${descriptor.color}`} /><span className="truncate">{descriptor.label}{event.label ? `: ${event.label}` : ''}{event.statusCode ? ` (${event.statusCode})` : ''}</span></span>{index < flow.events.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground/50" />}</div>;
        })}
      </div>
    </motion.div>
  );
}
