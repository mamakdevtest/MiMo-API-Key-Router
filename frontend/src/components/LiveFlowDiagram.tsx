import { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Server, KeyRound, Bot, Activity, AlertTriangle, CheckCircle2, Clock, XCircle, ArrowRight, Zap, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface StreamEvent {
  type: string;
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

// Group events by requestId for timeline display
interface RequestFlow {
  requestId: string;
  model: string;
  events: StreamEvent[];
  status: 'pending' | 'success' | 'failed';
  totalTokens: number;
  cost: number;
  streaming: boolean;
  attempts: number;
}

const EVENT_COLORS: Record<string, string> = {
  request_started: 'text-blue-400',
  key_selected: 'text-cyan-400',
  upstream_sent: 'text-indigo-400',
  upstream_response: 'text-violet-400',
  streaming_started: 'text-sky-400',
  streaming_completed: 'text-emerald-400',
  key_failed: 'text-red-400',
  failover_attempted: 'text-amber-400',
  request_completed: 'text-green-400',
};

const EVENT_ICONS: Record<string, typeof Activity> = {
  request_started: Activity,
  key_selected: KeyRound,
  upstream_sent: ArrowRight,
  upstream_response: Server,
  streaming_started: Zap,
  streaming_completed: CheckCircle2,
  key_failed: XCircle,
  failover_attempted: RefreshCw,
  request_completed: CheckCircle2,
};

const EVENT_LABELS: Record<string, string> = {
  request_started: 'Request Started',
  key_selected: 'Key Selected',
  upstream_sent: 'Upstream Sent',
  upstream_response: 'Response Received',
  streaming_started: 'Streaming Started',
  streaming_completed: 'Streaming Completed',
  key_failed: 'Key Failed',
  failover_attempted: 'Failover',
  request_completed: 'Completed',
};

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  exhausted: { bg: 'bg-orange-500/15', text: 'text-orange-400', label: 'Exhausted' },
  cooldown: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'Cooldown' },
  invalid: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Invalid' },
  disabled: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Disabled' },
};

export function LiveFlowDiagram() {
  const [flows, setFlows] = useState<RequestFlow[]>([]);
  const [activeEvent, setActiveEvent] = useState<StreamEvent | null>(null);
  const [pulse, setPulse] = useState(false);
  const [connected, setConnected] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sse = new EventSource('/admin/stream');

    sse.onopen = () => setConnected(true);
    sse.onerror = () => setConnected(false);

    sse.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as StreamEvent;
        if (data.type === 'connected' || data.type === 'ping') return;

        setActiveEvent(data);
        setPulse(true);
        setTimeout(() => setPulse(false), 800);

        if (!data.requestId) return;

        setFlows((prev) => {
          const existingIndex = prev.findIndex((f) => f.requestId === data.requestId);

          if (existingIndex >= 0) {
            const updated = [...prev];
            const flow = { ...updated[existingIndex] };
            flow.events = [...flow.events, data];

            if (data.type === 'request_completed') {
              flow.status = data.success ? 'success' : 'failed';
              flow.totalTokens = data.tokens ?? flow.totalTokens;
              flow.cost = data.cost ?? flow.cost;
            }
            if (data.type === 'streaming_completed') {
              flow.totalTokens = data.tokens ?? flow.totalTokens;
              flow.cost = data.cost ?? flow.cost;
            }
            if (data.type === 'key_selected') {
              flow.attempts = data.attempt ?? flow.attempts;
            }

            updated[existingIndex] = flow;
            return updated;
          }

          // New request
          const newFlow: RequestFlow = {
            requestId: data.requestId!,
            model: data.model || 'unknown',
            events: [data],
            status: 'pending',
            totalTokens: 0,
            cost: 0,
            streaming: data.streaming ?? false,
            attempts: 1,
          };

          // Keep max 8 flows
          const result = [newFlow, ...prev].slice(0, 8);
          return result;
        });
      } catch (err) {}
    };

    return () => {
      sse.close();
      setConnected(false);
    };
  }, []);

  // Auto-scroll timeline
  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = 0;
    }
  }, [flows]);

  const latestFlow = flows[0];
  const flowStatus = latestFlow?.status ?? 'pending';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
    >
      <Card className="mb-6 overflow-hidden border-2 border-muted relative glass-panel hover-glow">
        <CardHeader className="bg-muted/30 border-b border-white/5 pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="h-5 w-5 text-blue-400" />
              Live Request Flow
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]'}`} />
              <span className="text-xs text-muted-foreground">{connected ? 'Connected' : 'Disconnected'}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {/* Flow Diagram */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 relative max-w-4xl mx-auto mb-6">

            {/* Client Node */}
            <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center z-10">
              <div className={`w-14 h-14 rounded-2xl bg-blue-500/10 border-2 flex items-center justify-center transition-all duration-500 ${pulse ? 'border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.5)]' : 'border-blue-500/30'}`}>
                <Server className={`h-7 w-7 transition-colors duration-300 ${pulse ? 'text-blue-500' : 'text-blue-500/50'}`} />
              </div>
              <span className="mt-2 font-medium text-xs text-muted-foreground">Client</span>
            </motion.div>

            {/* Line 1 */}
            <div className="hidden md:block flex-1 h-0.5 bg-muted/50 relative overflow-hidden rounded-full">
              <motion.div
                className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full"
                initial={{ width: '0%', opacity: 0 }}
                animate={{ width: pulse ? '100%' : '0%', opacity: pulse ? 1 : 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
              />
            </div>

            {/* Router Node */}
            <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center z-10">
              <motion.div
                animate={{ scale: pulse ? 1.1 : 1 }}
                transition={{ duration: 0.3 }}
                className={`w-16 h-16 rounded-full bg-blue-500/10 border-2 flex items-center justify-center transition-all duration-500 ${pulse ? 'border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.5)]' : 'border-blue-500/30'}`}
              >
                <Activity className={`h-8 w-8 transition-colors duration-300 ${pulse ? 'text-blue-400' : 'text-blue-400/50'}`} />
              </motion.div>
              <span className="mt-2 font-bold text-sm text-gradient">Router</span>
              {latestFlow && latestFlow.attempts > 1 && (
                <motion.span
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-[10px] text-amber-400 font-semibold mt-0.5"
                >
                  {latestFlow.attempts} attempts
                </motion.span>
              )}
            </motion.div>

            {/* Line 2 */}
            <div className="hidden md:block flex-1 h-0.5 bg-muted/50 relative overflow-hidden rounded-full">
              <motion.div
                className={`absolute top-0 left-0 h-full rounded-full ${flowStatus === 'failed' ? 'bg-gradient-to-r from-cyan-500 to-red-500' : 'bg-gradient-to-r from-cyan-500 to-green-500'}`}
                initial={{ width: '0%', opacity: 0 }}
                animate={{ width: pulse ? '100%' : '0%', opacity: pulse ? 1 : 0 }}
                transition={{ duration: 0.3, delay: 0.15, ease: 'easeOut' }}
              />
            </div>

            {/* Key Node */}
            <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center z-10">
              <div className={`w-20 h-20 rounded-2xl border-[3px] flex flex-col items-center justify-center transition-all duration-500 relative ${pulse
                ? (flowStatus === 'failed' ? 'bg-red-500/10 border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.5)]' : 'bg-green-500/10 border-green-500 shadow-[0_0_30px_rgba(34,197,94,0.5)]')
                : 'bg-muted/50 border-muted-foreground/20'}`}>
                <KeyRound className={`h-5 w-5 mb-0.5 transition-colors duration-300 ${pulse
                  ? (flowStatus === 'failed' ? 'text-red-500' : 'text-green-500')
                  : 'text-muted-foreground/60'}`} />
                <span className="text-[9px] leading-tight font-semibold px-1 text-center break-all line-clamp-2">
                  {activeEvent?.label || 'Waiting...'}
                </span>
                {pulse && (
                  <span className="absolute inset-0 rounded-2xl -z-10">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-2xl opacity-40 ${flowStatus === 'failed' ? 'bg-red-400' : 'bg-green-400'}`} />
                  </span>
                )}
              </div>
              <span className="mt-2 font-medium text-xs text-muted-foreground">Active Key</span>
            </motion.div>

            {/* Line 3 */}
            <div className="hidden md:block flex-1 h-0.5 bg-muted/50 relative overflow-hidden rounded-full">
              <motion.div
                className={`absolute top-0 left-0 h-full rounded-full ${flowStatus === 'failed' ? 'bg-gradient-to-r from-red-500 to-red-600' : 'bg-gradient-to-r from-green-500 to-purple-500'}`}
                initial={{ width: '0%', opacity: 0 }}
                animate={{ width: pulse ? '100%' : '0%', opacity: pulse ? 1 : 0 }}
                transition={{ duration: 0.3, delay: 0.3, ease: 'easeOut' }}
              />
            </div>

            {/* Upstream Node */}
            <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center z-10">
              <div className={`w-14 h-14 rounded-2xl bg-purple-500/10 border-2 flex items-center justify-center transition-all duration-500 ${pulse ? 'border-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.5)]' : 'border-purple-500/30'}`}>
                <Bot className={`h-7 w-7 transition-colors duration-300 ${pulse ? 'text-purple-500' : 'text-purple-500/50'}`} />
              </div>
              <span className="mt-2 font-medium text-xs text-center max-w-[100px] truncate text-muted-foreground">
                {activeEvent?.model || 'Upstream'}
              </span>
            </motion.div>
          </div>

          {/* Live Stats Bar */}
          <AnimatePresence>
            {activeEvent && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className="max-w-4xl mx-auto rounded-xl border border-white/10 bg-background/60 backdrop-blur-md p-4 flex flex-wrap items-center justify-between gap-4 shadow-xl shadow-black/20 mb-6"
              >
                <div className="flex flex-col min-w-[110px]">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">Status</span>
                  {flowStatus === 'failed' ? (
                    <span className="text-red-500 font-bold flex items-center gap-1.5 text-sm">
                      <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" /> Failed
                    </span>
                  ) : flowStatus === 'pending' ? (
                    <span className="text-blue-500 font-bold flex items-center gap-1.5 text-sm">
                      <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.8)]" /> Processing
                    </span>
                  ) : (
                    <span className="text-green-500 font-bold flex items-center gap-1.5 text-sm">
                      <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]" /> Success
                    </span>
                  )}
                </div>
                <div className="flex flex-col flex-1 min-w-[120px]">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">Model</span>
                  <span className="font-medium text-sm truncate" title={activeEvent?.model || ''}>{activeEvent?.model || '-'}</span>
                </div>
                <div className="flex flex-col text-right min-w-[80px]">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">Tokens</span>
                  {flowStatus === 'pending' ? (
                    <span className="text-muted-foreground animate-pulse text-xs">Counting...</span>
                  ) : (
                    <motion.span
                      key={latestFlow?.totalTokens}
                      initial={{ opacity: 0, scale: 1.3 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="font-mono text-base font-semibold"
                    >
                      {(latestFlow?.totalTokens || 0).toLocaleString()}
                    </motion.span>
                  )}
                </div>
                <div className="flex flex-col text-right min-w-[100px]">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">Cost</span>
                  {flowStatus === 'pending' ? (
                    <span className="text-muted-foreground animate-pulse text-xs">Estimating...</span>
                  ) : (
                    <motion.span
                      key={latestFlow?.cost}
                      initial={{ opacity: 0, scale: 1.3 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="font-mono text-base font-semibold text-green-400 drop-shadow-[0_0_8px_rgba(34,197,94,0.4)]"
                    >
                      ${(latestFlow?.cost || 0).toFixed(6)}
                    </motion.span>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Event Timeline */}
          {flows.length > 0 && (
            <div ref={timelineRef} className="max-w-4xl mx-auto max-h-[320px] overflow-y-auto scrollbar-thin">
              <div className="space-y-2">
                {flows.slice(0, 5).map((flow) => (
                  <motion.div
                    key={flow.requestId}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="rounded-lg border border-white/5 bg-muted/20 p-3"
                  >
                    {/* Flow Header */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${flow.status === 'success' ? 'bg-green-500' : flow.status === 'failed' ? 'bg-red-500' : 'bg-blue-500 animate-pulse'}`} />
                        <span className="text-xs font-mono text-muted-foreground">{flow.requestId.slice(0, 8)}</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs font-medium">{flow.model}</span>
                        {flow.streaming && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 font-semibold">SSE</span>
                        )}
                        {flow.attempts > 1 && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-semibold">
                            {flow.attempts} attempts
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        {flow.totalTokens > 0 && (
                          <span className="text-muted-foreground font-mono">{flow.totalTokens.toLocaleString()} tok</span>
                        )}
                        {flow.cost > 0 && (
                          <span className="text-green-400 font-mono">${flow.cost.toFixed(6)}</span>
                        )}
                      </div>
                    </div>

                    {/* Event Steps */}
                    <div className="flex flex-wrap gap-1">
                      {flow.events.map((event, i) => {
                        const Icon = EVENT_ICONS[event.type] || Activity;
                        const color = EVENT_COLORS[event.type] || 'text-muted-foreground';
                        const label = EVENT_LABELS[event.type] || event.type;

                        return (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: i * 0.05 }}
                            className="flex items-center gap-1"
                            title={event.errorMessage ? `${label}: ${event.errorMessage}` : label}
                          >
                            <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${
                              event.type === 'key_failed' ? 'bg-red-500/10' :
                              event.type === 'failover_attempted' ? 'bg-amber-500/10' :
                              event.type === 'request_completed' ? (event.success ? 'bg-green-500/10' : 'bg-red-500/10') :
                              'bg-muted/30'
                            }`}>
                              <Icon className={`w-2.5 h-2.5 ${color}`} />
                              <span className={color}>{label}</span>
                              {event.label && event.type === 'key_selected' && (
                                <span className="text-muted-foreground ml-0.5">({event.label})</span>
                              )}
                              {event.keyStatus && STATUS_BADGE[event.keyStatus] && (
                                <span className={`ml-0.5 px-1 rounded text-[8px] ${STATUS_BADGE[event.keyStatus].bg} ${STATUS_BADGE[event.keyStatus].text}`}>
                                  {STATUS_BADGE[event.keyStatus].label}
                                </span>
                              )}
                              {event.statusCode && event.type === 'key_failed' && (
                                <span className="text-red-400/70 ml-0.5">{event.statusCode}</span>
                              )}
                            </div>
                            {i < flow.events.length - 1 && (
                              <ArrowRight className="w-2.5 h-2.5 text-muted-foreground/30" />
                            )}
                          </motion.div>
                        );
                      })}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {flows.length === 0 && (
            <div className="max-w-4xl mx-auto text-center py-6">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span className="text-sm">Waiting for requests...</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
