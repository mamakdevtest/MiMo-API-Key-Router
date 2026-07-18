import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock3, Gauge, Play, Square, XCircle, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

type BenchmarkReport = Awaited<ReturnType<typeof api.providers.benchmarkModels>>;

function metric(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${value} ms`;
}

export function ModelBenchmark() {
  const { toast } = useToast();
  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['providers'],
    queryFn: api.providers.list,
  });
  const [providerId, setProviderId] = useState('');
  const [concurrency, setConcurrency] = useState(3);
  const [limit, setLimit] = useState(20);
  const [allModelsSequentially, setAllModelsSequentially] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [report, setReport] = useState<BenchmarkReport | null>(null);

  useEffect(() => {
    if (!providerId && providers.length) setProviderId(providers[0].id);
  }, [providerId, providers]);

  const benchmark = useMutation({
    mutationFn: () => api.providers.benchmarkModels(providerId, { concurrency, limit }),
    onSuccess: (result) => {
      setReport(result);
      toast({
        title: 'Model benchmark completed',
        description: `${result.summary.successful}/${result.summary.total} models responded successfully.`,
      });
    },
    onError: (error: Error) => toast({ title: 'Benchmark failed', description: error.message, variant: 'destructive' }),
  });

  const startFullBenchmark = useMutation({
    mutationFn: () => api.providers.benchmarkAllModels(providerId),
    onSuccess: (job) => {
      setJobId(job.id);
      setReport(null);
      toast({ title: 'Sequential benchmark started', description: 'The dashboard will update while every eligible chat model is tested.' });
    },
    onError: (error: Error) => toast({ title: 'Benchmark failed', description: error.message, variant: 'destructive' }),
  });

  const { data: job } = useQuery({
    queryKey: ['model-benchmark-job', providerId, jobId],
    queryFn: () => api.providers.getBenchmarkJob(providerId, jobId!),
    enabled: !!providerId && !!jobId,
    refetchInterval: (query) => ['running', 'stopping'].includes(query.state.data?.status) ? 1000 : false,
  });

  const cancelFullBenchmark = useMutation({
    mutationFn: () => api.providers.cancelBenchmarkJob(providerId, jobId!),
    onSuccess: () => toast({ title: 'Stop requested', description: 'The current request will finish, then no further models will be tested.' }),
    onError: (error: Error) => toast({ title: 'Unable to stop benchmark', description: error.message, variant: 'destructive' }),
  });

  const isRunning = benchmark.isPending || startFullBenchmark.isPending || job?.status === 'running';
  const displayed = report ?? job;
  const results: BenchmarkReport['results'] = displayed?.results ?? [];
  const summary = displayed?.summary;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Model Benchmark</h1>
        <p className="text-muted-foreground mt-1">
          Check which synchronized chat models work and compare their end-to-end response latency with a one-token request.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gauge className="w-5 h-5" />Run a provider check</CardTitle>
          <CardDescription>
            Each model receives `Reply only: OK` with `max_tokens: 1`. Insufficient-balance responses exhaust a credential; Vercel free-tier rate limits remain available and are shown without latency.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-end">
          <label className="grid gap-2 flex-1 text-sm font-medium">
            Provider
            <select
              value={providerId}
              onChange={(event) => { setProviderId(event.target.value); setReport(null); setJobId(null); }}
              disabled={isLoading || providers.length === 0 || isRunning}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {providers.map((provider: any) => (
                <option key={provider.id} value={provider.id}>{provider.name} · {provider.type}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Parallel tests
            <select
              value={concurrency}
              onChange={(event) => setConcurrency(Number(event.target.value))}
              disabled={isRunning || allModelsSequentially}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Models per run
            <select
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
              disabled={isRunning || allModelsSequentially}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {[10, 20, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 self-center text-sm text-muted-foreground md:mt-6">
            <input
              type="checkbox"
              checked={allModelsSequentially}
              onChange={(event) => setAllModelsSequentially(event.target.checked)}
              disabled={isRunning}
              className="h-4 w-4"
            />
            Test every eligible model sequentially
          </label>
          <Button onClick={() => allModelsSequentially ? startFullBenchmark.mutate() : benchmark.mutate()} disabled={!providerId || isRunning}>
            <Play className="w-4 h-4 mr-2" />
            {isRunning ? 'Testing models…' : allModelsSequentially ? 'Test all sequentially' : 'Test chat models'}
          </Button>
          {job?.status === 'running' || job?.status === 'stopping' ? (
            <Button variant="destructive" onClick={() => cancelFullBenchmark.mutate()} disabled={cancelFullBenchmark.isPending || job.status === 'stopping'}>
              <Square className="w-4 h-4 mr-2" />{job.status === 'stopping' ? 'Stopping…' : 'Stop test'}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {displayed && summary && (
        <>
          {job?.status === 'running' && (
            <p className="text-sm text-muted-foreground">Sequential test in progress: {job.completed}/{job.total || '…'} models completed. You can keep this page open while results arrive.</p>
          )}
          {job?.status === 'stopping' && <p className="text-sm text-yellow-400">Stopping after the active model request finishes…</p>}
          {job?.status === 'failed' && <p className="text-sm text-red-400">Sequential test stopped: {job.error}</p>}
          {job?.status === 'cancelled' && <p className="text-sm text-yellow-400">Sequential test cancelled after {job.completed} models.</p>}
          {job && job.exhaustedCredentials?.length > 0 && (
            <p className="text-sm text-orange-400">Marked exhausted: {job.exhaustedCredentials.join(', ')}</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard title="Working models" value={`${summary.successful}/${summary.total}`} icon={<CheckCircle2 className="w-4 h-4 text-green-400" />} />
            <MetricCard title="Average latency" value={metric(summary.averageLatencyMs)} icon={<Clock3 className="w-4 h-4 text-blue-400" />} />
            <MetricCard title="Fastest response" value={metric(summary.fastestLatencyMs)} icon={<Zap className="w-4 h-4 text-yellow-400" />} />
            <MetricCard title="Failed models" value={String(summary.failed)} icon={<XCircle className="w-4 h-4 text-red-400" />} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Results · {displayed.providerName ?? 'Loading provider…'}</CardTitle>
              <CardDescription>{job ? 'Sequential full-catalog check' : `Credential: ${report?.credentialName} · concurrency: ${report?.concurrency}`}. Successful models are sorted by latency.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-muted/30">
                    <th className="px-4 py-3 text-left font-medium">Public model</th>
                    <th className="px-4 py-3 text-left font-medium">Credential</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Latency</th>
                    <th className="px-4 py-3 text-right font-medium">HTTP</th>
                    <th className="px-4 py-3 text-left font-medium">Details</th>
                  </tr></thead>
                  <tbody>{results.map((result) => (
                    <tr key={result.upstreamModelId} className="border-b last:border-0">
                      <td className="px-4 py-3 font-mono text-xs">{result.publicModelId}</td>
                      <td className="px-4 py-3 text-xs">{result.credentialName ?? '—'}</td>
                      <td className="px-4 py-3"><span className={result.status === 'success' ? 'text-green-400' : 'text-red-400'}>{result.rateLimited ? 'rate-limited (available)' : result.status}</span></td>
                      <td className="px-4 py-3 text-right font-mono">{result.rateLimited ? 'rate limited' : metric(result.latencyMs)}</td>
                      <td className="px-4 py-3 text-right font-mono">{result.httpStatus ?? '—'}</td>
                      <td className="px-4 py-3 max-w-sm truncate text-xs text-muted-foreground" title={result.error}>{result.error ?? 'Available'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function MetricCard({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  return <Card><CardContent className="p-5"><div className="flex items-center justify-between text-muted-foreground text-sm"><span>{title}</span>{icon}</div><p className="mt-2 text-2xl font-bold">{value}</p></CardContent></Card>;
}
