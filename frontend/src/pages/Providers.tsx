import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Server, Plus, CheckCircle2, XCircle, AlertTriangle, Clock, RefreshCw, Settings, Key, Database } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

const HEALTH_COLORS: Record<string, string> = {
  healthy: 'text-green-500',
  degraded: 'text-yellow-500',
  capacity_limited: 'text-orange-500',
  unavailable: 'text-red-500',
  disabled: 'text-gray-500',
  unknown: 'text-gray-400',
};

const HEALTH_ICONS: Record<string, typeof CheckCircle2> = {
  healthy: CheckCircle2,
  degraded: AlertTriangle,
  capacity_limited: AlertTriangle,
  unavailable: XCircle,
  disabled: XCircle,
  unknown: Clock,
};

export function Providers() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newProvider, setNewProvider] = useState({ type: 'featherless', name: '', slug: '', baseUrl: 'https://api.featherless.ai' });

  const providerPreset = useMemo(() => {
    if (newProvider.type === 'mimo') {
      return {
        namePlaceholder: 'My MiMo Account',
        slugPlaceholder: 'mimo-main',
        baseUrl: 'https://api.xiaomimimo.com/v1',
      };
    }

    return {
      namePlaceholder: 'My Featherless Account',
      slugPlaceholder: 'featherless-main',
      baseUrl: 'https://api.featherless.ai',
    };
  }, [newProvider.type]);

  const { data: providers, isLoading } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.providers.list(),
    refetchInterval: 30000,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.providers.create(data),
    onSuccess: (created: any) => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      setShowCreate(false);
      toast({ title: 'Provider created', description: 'Now add provider-specific API keys for this account.' });
      navigate(`/providers/${created.id}`);
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      enabled ? api.providers.enable(id) : api.providers.disable(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => api.providers.syncModels(id),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      toast({ title: 'Sync complete', description: `${result.added} added, ${result.updated} updated, ${result.removed} removed` });
    },
    onError: (err: Error) => toast({ title: 'Sync failed', description: err.message }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Providers</h1>
          <p className="text-muted-foreground">Manage AI provider instances and credentials.</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />Add Provider</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Provider</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Type</Label>
                <select className="w-full mt-1 p-2 rounded-md bg-background border" value={newProvider.type}
                  onChange={e => setNewProvider(p => ({
                    ...p,
                    type: e.target.value,
                    baseUrl: e.target.value === 'mimo' ? 'https://api.xiaomimimo.com/v1' : 'https://api.featherless.ai',
                  }))}>
                  <option value="featherless">Featherless.ai</option>
                  <option value="mimo">Xiaomi MiMo</option>
                </select>
              </div>
              <div>
                <Label>Name</Label>
                <Input value={newProvider.name} onChange={e => setNewProvider(p => ({ ...p, name: e.target.value }))} placeholder={providerPreset.namePlaceholder} />
              </div>
              <div>
                <Label>Slug</Label>
                <Input value={newProvider.slug} onChange={e => setNewProvider(p => ({ ...p, slug: e.target.value }))} placeholder={providerPreset.slugPlaceholder} />
              </div>
              <div>
                <Label>Base URL</Label>
                <Input value={newProvider.baseUrl} onChange={e => setNewProvider(p => ({ ...p, baseUrl: e.target.value }))} />
              </div>
              <p className="text-xs text-muted-foreground">
                Each provider keeps its own API key pool. After creation, you will be taken to that provider's key screen.
              </p>
              <Button onClick={() => createMutation.mutate(newProvider)} disabled={createMutation.isPending} className="w-full">
                {createMutation.isPending ? 'Creating...' : 'Create Provider'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {(providers ?? []).map((p: any) => {
          const HealthIcon = HEALTH_ICONS[p.healthStatus] || Clock;
          return (
            <Card key={p.id} className="hover:border-white/20 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${p.enabled ? 'bg-blue-500/15 text-blue-400' : 'bg-gray-500/15 text-gray-400'}`}>
                      {p.type === 'featherless' ? 'F' : p.type === 'mimo' ? 'M' : '?'}
                    </div>
                    <div>
                      <CardTitle className="text-base">{p.name}</CardTitle>
                      <CardDescription className="text-xs">{p.type} · {new URL(p.baseUrl).hostname}</CardDescription>
                    </div>
                  </div>
                  <Switch checked={p.enabled} onCheckedChange={(enabled) => toggleMutation.mutate({ id: p.id, enabled })} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <HealthIcon className={`w-4 h-4 ${HEALTH_COLORS[p.healthStatus]}`} />
                    <span className="capitalize">{p.healthStatus}</span>
                  </div>
                  <span className="text-muted-foreground">Priority: {p.priority}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-muted/30 rounded-lg p-2">
                    <div className="font-semibold text-lg">{p.credentialCount ?? 0}</div>
                    <div className="text-muted-foreground">Keys</div>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-2">
                    <div className="font-semibold text-lg">{p.modelCount ?? 0}</div>
                    <div className="text-muted-foreground">Models</div>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-2">
                    <div className="font-semibold text-sm capitalize">{p.billingMode}</div>
                    <div className="text-muted-foreground">Billing</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => syncMutation.mutate(p.id)} disabled={syncMutation.isPending}>
                    <RefreshCw className={`w-3 h-3 mr-1 ${syncMutation.isPending ? 'animate-spin' : ''}`} />Sync
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1" asChild>
                    <a href={`/providers/${p.id}`}><Settings className="w-3 h-3 mr-1" />Manage</a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {(!providers || providers.length === 0) && (
        <Card>
          <CardContent className="text-center py-12">
            <Server className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No providers configured</h3>
            <p className="text-muted-foreground mb-4">Add a provider to start routing AI requests.</p>
            <Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-2" />Add Provider</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
