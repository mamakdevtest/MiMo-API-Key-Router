import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Server, KeyRound, Bot, Activity } from 'lucide-react';

interface StreamEvent {
  type: string;
  keyId?: string;
  label?: string;
  model?: string;
  tokens?: number;
  cost?: number;
  success?: boolean;
  timestamp: number;
}

export function LiveFlowDiagram() {
  const [activeEvent, setActiveEvent] = useState<StreamEvent | null>(null);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const sse = new EventSource('/admin/stream');
    
    sse.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as StreamEvent;
        if (data.type === 'request_started' || data.type === 'request_completed') {
          setActiveEvent(data);
          setPulse(true);
          setTimeout(() => setPulse(false), 800);
        }
      } catch (err) {}
    };

    return () => sse.close();
  }, []);

  return (
    <Card className="mb-6 overflow-hidden border-2 border-muted relative">
      <CardHeader className="bg-muted/50 border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Activity className="h-5 w-5 text-primary" />
          Live Request Flow
        </CardTitle>
      </CardHeader>
      <CardContent className="p-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8 relative max-w-4xl mx-auto">
          
          {/* Client Node */}
          <div className="flex flex-col items-center z-10">
            <div className={`w-16 h-16 rounded-2xl bg-blue-500/10 border-2 flex items-center justify-center transition-colors duration-500 ${pulse ? 'border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.5)]' : 'border-blue-500/30'}`}>
              <Server className={`h-8 w-8 ${pulse ? 'text-blue-500' : 'text-blue-500/50'}`} />
            </div>
            <span className="mt-3 font-medium text-sm">Client App</span>
          </div>

          {/* Connection Line 1 */}
          <div className="hidden md:block flex-1 h-0.5 bg-muted relative">
            <div className={`absolute top-0 left-0 h-full bg-blue-500 transition-all duration-300 ease-out ${pulse ? 'w-full opacity-100' : 'w-0 opacity-0'}`} />
          </div>

          {/* Router Node */}
          <div className="flex flex-col items-center z-10">
            <div className={`w-20 h-20 rounded-full bg-primary/10 border-2 flex items-center justify-center transition-colors duration-500 ${pulse ? 'border-primary shadow-[0_0_30px_rgba(var(--primary),0.5)] scale-110' : 'border-primary/30'}`}>
              <Activity className={`h-10 w-10 ${pulse ? 'text-primary' : 'text-primary/50'}`} />
            </div>
            <span className="mt-3 font-bold text-base">MiMo Router</span>
          </div>

          {/* Connection Line 2 */}
          <div className="hidden md:block flex-1 h-0.5 bg-muted relative">
            <div className={`absolute top-0 left-0 h-full bg-green-500 transition-all duration-300 delay-150 ease-out ${pulse ? 'w-full opacity-100' : 'w-0 opacity-0'}`} />
          </div>

          {/* Active Key Node */}
          <div className="flex flex-col items-center z-10">
            <div className={`w-24 h-24 rounded-2xl border-4 flex flex-col items-center justify-center transition-all duration-500 ${pulse ? (activeEvent?.success === false ? 'bg-red-500/10 border-red-500 shadow-[0_0_40px_rgba(239,68,68,0.6)]' : 'bg-green-500/10 border-green-500 shadow-[0_0_40px_rgba(34,197,94,0.6)]') : 'bg-muted border-muted-foreground/20'} relative`}>
              <KeyRound className={`h-8 w-8 mb-1 ${pulse ? (activeEvent?.success === false ? 'text-red-500' : 'text-green-500') : 'text-muted-foreground'}`} />
              <span className="text-xs font-bold px-2 text-center break-all line-clamp-1">{activeEvent?.label || 'Waiting...'}</span>
              
              {/* Ping Animation Ring */}
              {pulse && (
                <span className="absolute inset-0 rounded-2xl flex items-center justify-center -z-10">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-2xl opacity-75 ${activeEvent?.success === false ? 'bg-red-400' : 'bg-green-400'}`}></span>
                </span>
              )}
            </div>
            <span className="mt-3 font-medium text-sm text-center">
              Active Key
            </span>
          </div>

          {/* Connection Line 3 */}
          <div className="hidden md:block flex-1 h-0.5 bg-muted relative">
            <div className={`absolute top-0 left-0 h-full transition-all duration-300 delay-300 ease-out ${pulse ? (activeEvent?.success === false ? 'bg-red-500 w-full opacity-100' : 'bg-green-500 w-full opacity-100') : 'w-0 opacity-0'}`} />
          </div>

          {/* Upstream Provider Node */}
          <div className="flex flex-col items-center z-10">
            <div className={`w-16 h-16 rounded-2xl bg-purple-500/10 border-2 flex items-center justify-center transition-colors duration-500 ${pulse ? 'border-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.5)]' : 'border-purple-500/30'}`}>
              <Bot className={`h-8 w-8 ${pulse ? 'text-purple-500' : 'text-purple-500/50'}`} />
            </div>
            <span className="mt-3 font-medium text-sm text-center">
              {activeEvent?.model || 'Upstream AI'}
            </span>
          </div>
        </div>

        {/* Live Details Bar */}
        <div className={`mt-8 max-w-4xl mx-auto rounded-xl border bg-card p-4 flex flex-wrap items-center justify-between gap-4 transition-opacity duration-500 ${activeEvent ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Last Status</span>
            {activeEvent?.success === false ? (
              <span className="text-red-500 font-bold flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500"></div> Failed</span>
            ) : activeEvent?.type === 'request_started' ? (
              <span className="text-blue-500 font-bold flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div> Processing...
              </span>
            ) : (
              <span className="text-green-500 font-bold flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500"></div> Success</span>
            )}
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Model</span>
            <span className="font-medium">{activeEvent?.model || '-'}</span>
          </div>
          <div className="flex flex-col text-right">
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Tokens Used</span>
            <span className="font-mono text-lg">{activeEvent?.tokens || 0}</span>
          </div>
          <div className="flex flex-col text-right">
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Cost</span>
            <span className="font-mono text-lg text-green-500">${(activeEvent?.cost || 0).toFixed(6)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
