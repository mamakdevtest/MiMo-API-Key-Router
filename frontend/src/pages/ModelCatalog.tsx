import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, Search, Filter, Wrench, Eye, MessageSquare, Layers } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

export function ModelCatalog() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const perPage = 50;

  const { data, isLoading } = useQuery({
    queryKey: ['model-catalog', page, search],
    queryFn: () => api.modelCatalog.list(page, perPage, search),
    refetchInterval: 60000,
  });

  const models = data?.models ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Model Catalog</h1>
          <p className="text-muted-foreground">All models synced from providers.</p>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search models..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-10" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-3 px-4 font-medium">Provider</th>
                  <th className="text-left py-3 px-4 font-medium">Model ID</th>
                  <th className="text-left py-3 px-4 font-medium">Display Name</th>
                  <th className="text-left py-3 px-4 font-medium">Class</th>
                  <th className="text-center py-3 px-4 font-medium">Context</th>
                  <th className="text-center py-3 px-4 font-medium">Capabilities</th>
                  <th className="text-center py-3 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">Loading...</td></tr>
                ) : models.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">
                    <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    No models found. Sync a provider first.
                  </td></tr>
                ) : (
                  models.map((m: any) => (
                    <tr key={m.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="py-2 px-4">
                        <span className="text-xs px-2 py-1 rounded bg-blue-500/15 text-blue-400 font-mono">{m.providerId?.slice(0, 8)}</span>
                      </td>
                      <td className="py-2 px-4 font-mono text-xs max-w-[200px] truncate" title={m.upstreamModelId}>{m.upstreamModelId}</td>
                      <td className="py-2 px-4">{m.displayName || '-'}</td>
                      <td className="py-2 px-4 text-muted-foreground text-xs">{m.modelClass || '-'}</td>
                      <td className="py-2 px-4 text-center font-mono text-xs">{m.contextLength ? `${(m.contextLength / 1000).toFixed(0)}K` : '-'}</td>
                      <td className="py-2 px-4">
                        <div className="flex items-center justify-center gap-1">
                          {m.supportsChat ? <span title="Chat"><MessageSquare className="w-3 h-3 text-blue-400" /></span> : null}
                          {m.supportsTools ? <span title="Tools"><Wrench className="w-3 h-3 text-green-400" /></span> : null}
                          {m.supportsVision ? <span title="Vision"><Eye className="w-3 h-3 text-purple-400" /></span> : null}
                          {m.supportsEmbeddings ? <span title="Embeddings"><Layers className="w-3 h-3 text-orange-400" /></span> : null}
                        </div>
                      </td>
                      <td className="py-2 px-4 text-center">
                        <span className={`text-xs px-2 py-1 rounded ${
                          m.status === 'active' ? 'bg-green-500/15 text-green-400' :
                          m.status === 'pending_deploy' ? 'bg-yellow-500/15 text-yellow-400' :
                          'bg-red-500/15 text-red-400'
                        }`}>{m.status}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Page {page} · {models.length} models</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
          <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={models.length < perPage}>Next</Button>
        </div>
      </div>
    </div>
  );
}
