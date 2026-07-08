import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Server, KeyRound, Bot, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
    >
      <Card className="mb-6 overflow-hidden border-2 border-muted relative glass-panel hover-glow">
        <CardHeader className="bg-muted/30 border-b border-white/5 pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5 text-blue-400" />
            Live Request Flow
          </CardTitle>
        </CardHeader>
        <CardContent className="p-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8 relative max-w-4xl mx-auto">
            
            {/* Client Node */}
            <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center z-10">
              <div className={`w-16 h-16 rounded-2xl bg-blue-500/10 border-2 flex items-center justify-center transition-colors duration-500 ${pulse ? 'border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.5)]' : 'border-blue-500/30'}`}>
                <Server className={`h-8 w-8 ${pulse ? 'text-blue-500' : 'text-blue-500/50'}`} />
              </div>
              <span className="mt-3 font-medium text-sm">Client App</span>
            </motion.div>

            {/* Connection Line 1 */}
            <div className="hidden md:block flex-1 h-0.5 bg-muted relative">
              <motion.div 
                className="absolute top-0 left-0 h-full bg-blue-500"
                initial={{ width: "0%", opacity: 0 }}
                animate={{ width: pulse ? "100%" : "0%", opacity: pulse ? 1 : 0 }}
                transition={{ duration: 0.3 }}
              />
            </div>

            {/* Router Node */}
            <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center z-10">
              <motion.div 
                animate={{ scale: pulse ? 1.1 : 1 }}
                className={`w-20 h-20 rounded-full bg-blue-500/10 border-2 flex items-center justify-center transition-colors duration-500 ${pulse ? 'border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.5)]' : 'border-blue-500/30'}`}
              >
                <Activity className={`h-10 w-10 ${pulse ? 'text-blue-400' : 'text-blue-400/50'}`} />
              </motion.div>
              <span className="mt-3 font-bold text-base text-gradient">MiMo Router</span>
            </motion.div>

            {/* Connection Line 2 */}
            <div className="hidden md:block flex-1 h-0.5 bg-muted relative">
              <motion.div 
                className="absolute top-0 left-0 h-full bg-green-500"
                initial={{ width: "0%", opacity: 0 }}
                animate={{ width: pulse ? "100%" : "0%", opacity: pulse ? 1 : 0 }}
                transition={{ duration: 0.3, delay: 0.15 }}
              />
            </div>

            {/* Active Key Node */}
            <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center z-10">
              <div className={`w-24 h-24 rounded-2xl border-4 flex flex-col items-center justify-center transition-all duration-500 ${pulse ? (activeEvent?.success === false ? 'bg-red-500/10 border-red-500 shadow-[0_0_40px_rgba(239,68,68,0.6)]' : 'bg-green-500/10 border-green-500 shadow-[0_0_40px_rgba(34,197,94,0.6)]') : 'bg-muted border-muted-foreground/20'} relative`}>
                <KeyRound className={`h-6 w-6 mb-1 ${pulse ? (activeEvent?.success === false ? 'text-red-500' : 'text-green-500') : 'text-muted-foreground'}`} />
                <span className="text-[10px] leading-tight font-bold px-1 text-center break-all line-clamp-3">{activeEvent?.label || 'Waiting...'}</span>
                
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
            </motion.div>

            {/* Connection Line 3 */}
            <div className="hidden md:block flex-1 h-0.5 bg-muted relative">
              <motion.div 
                className={`absolute top-0 left-0 h-full ${activeEvent?.success === false ? 'bg-red-500' : 'bg-green-500'}`}
                initial={{ width: "0%", opacity: 0 }}
                animate={{ width: pulse ? "100%" : "0%", opacity: pulse ? 1 : 0 }}
                transition={{ duration: 0.3, delay: 0.3 }}
              />
            </div>

            {/* Upstream Provider Node */}
            <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center z-10">
              <div className={`w-16 h-16 rounded-2xl bg-purple-500/10 border-2 flex items-center justify-center transition-colors duration-500 ${pulse ? 'border-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.5)]' : 'border-purple-500/30'}`}>
                <Bot className={`h-8 w-8 ${pulse ? 'text-purple-500' : 'text-purple-500/50'}`} />
              </div>
              <span className="mt-3 font-medium text-sm text-center max-w-[120px] break-words">
                {activeEvent?.model || 'Upstream AI'}
              </span>
            </motion.div>
          </div>

          {/* Live Details Bar */}
          <AnimatePresence>
            {activeEvent && (
              <motion.div 
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className="mt-8 max-w-4xl mx-auto rounded-xl border border-white/10 bg-background/50 backdrop-blur-md p-4 flex flex-wrap items-center justify-between gap-4 shadow-xl shadow-black/20"
              >
                <div className="flex flex-col min-w-[120px]">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Last Status</span>
                  {activeEvent?.success === false ? (
                    <span className="text-red-500 font-bold flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"></div> Failed</span>
                  ) : activeEvent?.type === 'request_started' ? (
                    <span className="text-blue-500 font-bold flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.8)]"></div> Processing
                    </span>
                  ) : (
                    <span className="text-green-500 font-bold flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]"></div> Success</span>
                  )}
                </div>
                <div className="flex flex-col flex-1 min-w-[150px]">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Model</span>
                  <span className="font-medium truncate" title={activeEvent?.model || ''}>{activeEvent?.model || '-'}</span>
                </div>
                <div className="flex flex-col text-right min-w-[100px]">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Tokens</span>
                  {activeEvent?.type === 'request_started' ? (
                    <span className="text-muted-foreground animate-pulse text-sm mt-0.5">Calculating...</span>
                  ) : (
                    <motion.span 
                      key={activeEvent.tokens}
                      initial={{ opacity: 0, scale: 1.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="font-mono text-lg"
                    >
                      {activeEvent?.tokens || 0}
                    </motion.span>
                  )}
                </div>
                <div className="flex flex-col text-right min-w-[120px]">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Cost</span>
                  {activeEvent?.type === 'request_started' ? (
                    <span className="text-muted-foreground animate-pulse text-sm mt-0.5">Estimating...</span>
                  ) : (
                    <motion.span 
                      key={activeEvent.cost}
                      initial={{ opacity: 0, scale: 1.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="font-mono text-lg text-green-400 drop-shadow-[0_0_8px_rgba(34,197,94,0.4)]"
                    >
                      ${(activeEvent?.cost || 0).toFixed(6)}
                    </motion.span>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}
