import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Search, Wrench, Eye, MessageSquare, Layers, Route, X, Plus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api, type ModelBenchmark, type ModelHealth } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

type CatalogModel = {
  id: string;
  providerName: string;
  providerType: string;
  publicModelId: string;
  upstreamModelId: string;
  displayName: string | null;
  status: string;
  contextLength: number | null;
  supportsChat: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsEmbeddings: boolean;
  health: ModelHealth;
  benchmark: ModelBenchmark | null;
};

function canJoinMix(model: CatalogModel): boolean {
  return model.status === 'active' && model.supportsChat;
}

const healthStyle: Record<CatalogModel['health'], string> = {
  ready: 'bg-green-500/15 text-green-400',
  rate_limited: 'bg-amber-500/15 text-amber-400',
  untested: 'bg-slate-500/15 text-slate-300',
  stale: 'bg-yellow-500/15 text-yellow-400',
  failed: 'bg-red-500/15 text-red-400',
  inactive: 'bg-zinc-500/15 text-zinc-400',
};

const healthLabel: Record<CatalogModel['health'], string> = {
  ready: 'Ready',
  rate_limited: 'Rate limited',
  untested: 'Untested',
  stale: 'Stale',
  failed: 'Failed',
  inactive: 'Inactive',
};

function healthText(model: Pick<CatalogModel, 'health' | 'benchmark'>) {
  if (model.health === 'rate_limited') return 'Rate limited';
  if (model.benchmark?.latencyMs != null) return `${model.benchmark.latencyMs}ms`;
  if (model.benchmark?.httpStatus != null) return `HTTP ${model.benchmark.httpStatus}`;
  return healthLabel[model.health];
}

function testedText(benchmark: ModelBenchmark | null) {
  if (!benchmark) return 'Never';
  const time = new Date(benchmark.testedAt);
  return Number.isNaN(time.getTime()) ? '—' : time.toLocaleString();
}

export function ModelCatalog() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [mixAlias, setMixAlias] = useState('vercel.mix.router');
  const [mixSearch, setMixSearch] = useState('');
  const [selectedModels, setSelectedModels] = useState<Record<string, CatalogModel>>({});
  const [searchParams] = useSearchParams();
  const providerId = searchParams.get('providerId') ?? undefined;
  const perPage = 50;

  const { data, isLoading } = useQuery({
    queryKey: ['model-catalog', page, search, providerId],
    queryFn: () => api.modelCatalog.list(page, perPage, search, providerId),
    refetchInterval: 60000,
  });

  const { data: savedMixRoutes = [] } = useQuery({
    queryKey: ['mix-routes'],
    queryFn: api.mixRoutes.list,
    refetchInterval: 60000,
  });

  const { data: mixSearchData, isFetching: isSearchingMixModels } = useQuery({
    queryKey: ['mix-router-model-search', mixSearch],
    queryFn: () => api.modelCatalog.list(1, 20, mixSearch.trim(), providerId),
    enabled: mixSearch.trim().length >= 2,
  });

  const models = (data?.models ?? []) as CatalogModel[];
  const selected = Object.values(selectedModels);
  const selectableOnPage = models.filter(canJoinMix);
  const mixSearchResults = ((mixSearchData?.models ?? []) as CatalogModel[])
    .filter(canJoinMix)
    .filter((model) => !selectedModels[model.id]);
  const allPageModelsSelected = selectableOnPage.length > 0 && selectableOnPage.every((model) => selectedModels[model.id]);

  const toggleModel = (model: CatalogModel) => {
    if (!canJoinMix(model)) return;
    setSelectedModels((current) => {
      const next = { ...current };
      if (next[model.id]) delete next[model.id];
      else next[model.id] = model;
      return next;
    });
  };

  const addModelToMix = (model: CatalogModel) => {
    if (!canJoinMix(model)) return;
    setSelectedModels((current) => current[model.id] ? current : { ...current, [model.id]: model });
  };

  const loadMixRoute = (route: typeof savedMixRoutes[number]) => {
    setMixAlias(route.publicModelId);
    setSelectedModels(Object.fromEntries(route.targets.map((target) => [target.providerModelId, {
      id: target.providerModelId,
      providerName: target.providerName,
      providerType: target.providerType,
      publicModelId: target.publicModelId,
      upstreamModelId: target.upstreamModelId,
      displayName: null,
      status: 'active',
      contextLength: null,
      supportsChat: true,
      supportsTools: false,
      supportsVision: false,
      supportsEmbeddings: false,
      health: target.health,
      benchmark: target.benchmark,
    }])));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const togglePageModels = () => {
    setSelectedModels((current) => {
      const next = { ...current };
      if (allPageModelsSelected) selectableOnPage.forEach((model) => delete next[model.id]);
      else selectableOnPage.forEach((model) => { next[model.id] = model; });
      return next;
    });
  };

  const createMixRoute = useMutation({
    mutationFn: () => api.mixRoutes.create({
      publicModelId: mixAlias.trim(),
      providerModelIds: selected.map((model) => model.id),
    }),
    onSuccess: (route) => {
      toast({ title: 'Mix router saved', description: `Clients can now use ${route.publicModelId}.` });
      setSelectedModels({});
      setMixSearch('');
      queryClient.invalidateQueries({ queryKey: ['model-catalog'] });
      queryClient.invalidateQueries({ queryKey: ['mix-routes'] });
    },
    onError: (error: Error) => toast({ title: 'Unable to save mix router', description: error.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Model Catalog</h1>
          <p className="text-muted-foreground">Healthy models are listed first. Benchmark health guides selection only and never changes gateway failover.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Route className="w-5 h-5" />Mix router builder</CardTitle>
          <CardDescription>
            Select at least two active chat models below. Their selection order becomes the failover order; create as many aliases as you need. Vercel free-tier limits try each active key twice before the next selected model.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="grid flex-1 gap-2 text-sm font-medium">
              Public alias
              <Input value={mixAlias} onChange={(event) => setMixAlias(event.target.value)} placeholder="vercel.mix.router" />
            </label>
            <Button onClick={() => createMixRoute.mutate()} disabled={mixAlias.trim().length < 3 || selected.length < 2 || createMixRoute.isPending}>
              {createMixRoute.isPending ? 'Saving…' : `Create mix router (${selected.length})`}
            </Button>
          </div>
          <label className="grid gap-2 text-sm font-medium">
            Add a model by search
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={mixSearch} onChange={(event) => setMixSearch(event.target.value)} className="pl-10" placeholder="Search a provider, public ID, or upstream model to add…" />
            </div>
          </label>
          {mixSearch.trim().length >= 2 && (
            <div className="rounded-md border">
              {isSearchingMixModels ? <p className="p-3 text-sm text-muted-foreground">Searching models…</p> : mixSearchResults.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No additional active chat models found.</p> : (
                <div className="max-h-56 divide-y overflow-y-auto">
                  {mixSearchResults.map((model) => (
                    <button key={model.id} type="button" onClick={() => addModelToMix(model)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/40">
                      <span><span className="block font-mono text-xs">{model.publicModelId}</span><span className="text-xs text-muted-foreground">{model.providerName} · {healthText(model)}</span></span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-primary"><Plus className="h-3 w-3" />Add</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {selected.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selected.map((model, index) => (
                <button key={model.id} type="button" onClick={() => toggleModel(model)} className="inline-flex max-w-full items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 font-mono text-xs text-primary" title="Remove from mix">
                  <span>{index + 1}. {model.publicModelId} · {healthText(model)}</span><X className="h-3 w-3 shrink-0" />
                </button>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setSelectedModels({})}>Clear selection</Button>
            </div>
          ) : <p className="text-sm text-muted-foreground">Choose active chat models from the catalog. You can keep selecting while changing pages or searching.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved mix routers</CardTitle>
          <CardDescription>Mix routers are managed separately from the raw model catalog. Select one to load it into the builder and update its model order.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {savedMixRoutes.length === 0 ? <p className="text-sm text-muted-foreground">No mix routers created yet.</p> : savedMixRoutes.map((route) => (
            <div key={route.id} className="flex flex-col gap-3 rounded-md border p-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0"><p className="font-mono text-sm text-primary">{route.publicModelId}</p><p className="mt-1 truncate text-xs text-muted-foreground">{route.targets.map((target) => `${target.publicModelId} (${healthText(target)})`).join(' → ')}</p></div>
              <Button variant="outline" size="sm" onClick={() => loadMixRoute(route)}>Edit mix</Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search provider, public model ID, or upstream model..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-10" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="w-12 py-3 px-4 text-center"><input type="checkbox" aria-label="Select active chat models on this page" checked={allPageModelsSelected} onChange={togglePageModels} disabled={selectableOnPage.length === 0} className="h-4 w-4" /></th>
                  <th className="text-left py-3 px-4 font-medium">Provider</th>
                  <th className="text-left py-3 px-4 font-medium">Public Model ID</th>
                  <th className="text-left py-3 px-4 font-medium">Upstream Model</th>
                  <th className="text-left py-3 px-4 font-medium">Display Name</th>
                  <th className="text-center py-3 px-4 font-medium">Context</th>
                  <th className="text-center py-3 px-4 font-medium">Capabilities</th>
                  <th className="text-center py-3 px-4 font-medium">Health</th>
                  <th className="text-center py-3 px-4 font-medium">Last benchmark</th>
                  <th className="text-center py-3 px-4 font-medium">Last tested</th>
                  <th className="text-center py-3 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={11} className="text-center py-12 text-muted-foreground">Loading...</td></tr>
                ) : models.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-12 text-muted-foreground">
                    <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    No models found. Sync a provider from its own details page.
                  </td></tr>
                ) : (
                  models.map((model) => {
                    const selectable = canJoinMix(model);
                    return (
                      <tr key={model.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="py-2 px-4 text-center"><input type="checkbox" aria-label={`Select ${model.publicModelId}`} checked={!!selectedModels[model.id]} onChange={() => toggleModel(model)} disabled={!selectable} className="h-4 w-4" /></td>
                        <td className="py-2 px-4"><div className="space-y-1"><div className="font-medium">{model.providerName}</div><div className="text-xs text-muted-foreground">{model.providerType}</div></div></td>
                        <td className="py-2 px-4 font-mono text-xs max-w-[260px] truncate" title={model.publicModelId}>{model.publicModelId}</td>
                        <td className="py-2 px-4 font-mono text-xs max-w-[220px] truncate" title={model.upstreamModelId}>{model.upstreamModelId}</td>
                        <td className="py-2 px-4">{model.displayName || '-'}</td>
                        <td className="py-2 px-4 text-center font-mono text-xs">{model.contextLength ? `${(model.contextLength / 1000).toFixed(0)}K` : '-'}</td>
                        <td className="py-2 px-4"><div className="flex items-center justify-center gap-1">{model.supportsChat ? <span title="Chat"><MessageSquare className="w-3 h-3 text-blue-400" /></span> : null}{model.supportsTools ? <span title="Tools"><Wrench className="w-3 h-3 text-green-400" /></span> : null}{model.supportsVision ? <span title="Vision"><Eye className="w-3 h-3 text-purple-400" /></span> : null}{model.supportsEmbeddings ? <span title="Embeddings"><Layers className="w-3 h-3 text-orange-400" /></span> : null}</div></td>
                        <td className="py-2 px-4 text-center"><span className={`whitespace-nowrap rounded px-2 py-1 text-xs ${healthStyle[model.health]}`}>{healthLabel[model.health]}</span></td>
                        <td className="py-2 px-4 text-center font-mono text-xs whitespace-nowrap">{healthText(model)}{model.benchmark?.httpStatus != null && model.health !== 'rate_limited' ? <span className="block text-muted-foreground">HTTP {model.benchmark.httpStatus}</span> : null}</td>
                        <td className="py-2 px-4 text-center text-xs text-muted-foreground whitespace-nowrap" title={model.benchmark?.testedAt}>{testedText(model.benchmark)}</td>
                        <td className="py-2 px-4 text-center"><span className={`text-xs px-2 py-1 rounded ${model.status === 'active' ? 'bg-green-500/15 text-green-400' : model.status === 'possibly_removed' ? 'bg-yellow-500/15 text-yellow-400' : 'bg-red-500/15 text-red-400'}`}>{model.status}</span></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Page {page} · {models.length} models · {selected.length} selected</span>
        <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button><Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={models.length < perPage}>Next</Button></div>
      </div>
    </div>
  );
}
