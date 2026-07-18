import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Server, Plus, CheckCircle2, XCircle, AlertTriangle, Clock, RefreshCw, Settings, Key, Database, Zap, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

type ProviderType = 'mimo' | 'featherless' | 'orcarouter' | 'openai_compatible';

const TYPE_PRESETS: Record<ProviderType, { label: string; baseUrl: string; namePlaceholder: string; slugPlaceholder: string }> = {
  mimo: { label: 'Xiaomi MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', namePlaceholder: 'My MiMo Account', slugPlaceholder: 'mimo-main' },
  featherless: { label: 'Featherless.ai', baseUrl: 'https://api.featherless.ai', namePlaceholder: 'My Featherless Account', slugPlaceholder: 'featherless-main' },
  orcarouter: { label: 'OrcaRouter', baseUrl: 'https://api.orcarouter.ai/v1', namePlaceholder: 'My OrcaRouter Account', slugPlaceholder: 'orcarouter-main' },
  openai_compatible: { label: 'Custom OpenAI-Compatible', baseUrl: '', namePlaceholder: 'My Custom Provider', slugPlaceholder: 'custom-provider' },
};

const TYPE_BADGES: Record<string, string> = { mimo: 'M', featherless: 'F', orcarouter: 'O', openai_compatible: 'C' };

interface ValidationResult {
  urlSafe: boolean;
  modelsReachable: boolean;
  authValid: boolean | null;
  streamingWorks: boolean | null;
  modelsCount: number | null;
  capabilities: Record<string, boolean>;
  errors: string[];
  warnings: string[];
}

function ValidationRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
      <span>{label}</span>
      {detail && <span className="text-muted-foreground text-xs">({detail})</span>}
    </div>
  );
}

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
  const [newProvider, setNewProvider] = useState<{
    type: ProviderType;
    name: string;
    slug: string;
    baseUrl: string;
    secret: string;
    documentationUrl: string;
    authHeader: string;
    authPrefix: string;
    modelsEndpoint: string;
    chatCompletionsEndpoint: string;
    timeoutMs: string;
  }>({
    type: 'featherless',
    name: '',
    slug: '',
    baseUrl: TYPE_PRESETS.featherless.baseUrl,
    secret: '',
    documentationUrl: '',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    modelsEndpoint: '/models',
    chatCompletionsEndpoint: '/chat/completions',
    timeoutMs: '',
  });
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  const providerPreset = useMemo(() => TYPE_PRESETS[newProvider.type], [newProvider.type]);
  const isCustom = newProvider.type === 'openai_compatible';

  const { data: providers, isLoading } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.providers.list(),
    refetchInterval: 30000,
  });

  const validateMutation = useMutation({
    mutationFn: () => api.providers.validate({
      baseUrl: newProvider.baseUrl,
      secret: newProvider.secret || undefined,
      authHeader: newProvider.authHeader || undefined,
      authPrefix: newProvider.authPrefix || undefined,
      modelsEndpoint: newProvider.modelsEndpoint || undefined,
      chatCompletionsEndpoint: newProvider.chatCompletionsEndpoint || undefined,
      timeoutMs: newProvider.timeoutMs ? parseInt(newProvider.timeoutMs, 10) : undefined,
    }),
    onSuccess: (result) => setValidation(result),
    onError: (err: Error) => toast({ title: 'Validation failed', description: err.message }),
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const created = await api.providers.create(data);
      // If a secret was provided, attach it as the first credential
      if (newProvider.secret) {
        await api.providers.credentials.create(created.id, { name: 'Default', secret: newProvider.secret });
      }
      // Auto-sync models after creation
      try { await api.providers.syncModels(created.id); } catch { /* optional */ }
      return created;
    },
    onSuccess: (created: any) => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      setShowCreate(false);
      setValidation(null);
      toast({ title: 'Provider created', description: 'Credentials added and models synced.' });
      navigate(`/providers/${created.id}`);
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message }),
  });

  const handleTypeChange = (type: ProviderType) => {
    setNewProvider((p) => ({ ...p, type, baseUrl: TYPE_PRESETS[type].baseUrl }));
    setValidation(null);
  };

  const buildCreatePayload = () => ({
    type: newProvider.type,
    name: newProvider.name,
    slug: newProvider.slug,
    baseUrl: newProvider.baseUrl,
    documentationUrl: newProvider.documentationUrl || undefined,
    authHeader: newProvider.authHeader || undefined,
    authPrefix: newProvider.authPrefix || undefined,
    modelsEndpoint: newProvider.modelsEndpoint || undefined,
    chatCompletionsEndpoint: newProvider.chatCompletionsEndpoint || undefined,
    timeoutMs: newProvider.timeoutMs ? parseInt(newProvider.timeoutMs, 10) : undefined,
    capabilities: validation?.capabilities ?? undefined,
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
        <Dialog open={showCreate} onOpenChange={(open) => { setShowCreate(open); if (!open) setValidation(null); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />Add Provider</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Provider</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Provider Type</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {(Object.keys(TYPE_PRESETS) as ProviderType[]).map((t) => (
                    <button key={t} type="button" onClick={() => handleTypeChange(t)}
                      className={`p-2 rounded-md border text-sm text-left transition-colors ${newProvider.type === t ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-white/10 hover:border-white/20'}`}>
                      {TYPE_PRESETS[t].label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Name</Label>
                  <Input value={newProvider.name} onChange={e => setNewProvider(p => ({ ...p, name: e.target.value }))} placeholder={providerPreset.namePlaceholder} />
                </div>
                <div>
                  <Label>Slug</Label>
                  <Input value={newProvider.slug} onChange={e => setNewProvider(p => ({ ...p, slug: e.target.value }))} placeholder={providerPreset.slugPlaceholder} />
                </div>
              </div>

              <div>
                <Label>Base URL</Label>
                <Input value={newProvider.baseUrl} onChange={e => { setNewProvider(p => ({ ...p, baseUrl: e.target.value })); setValidation(null); }} placeholder="https://api.example.com/v1" />
              </div>

              <div>
                <Label>API Key {isCustom ? '(optional, used for connection test)' : '(optional)'}</Label>
                <Input type="password" value={newProvider.secret} onChange={e => setNewProvider(p => ({ ...p, secret: e.target.value }))} placeholder="sk-..." />
              </div>

              {isCustom && (
                <>
                  <div>
                    <Label>Documentation URL (optional)</Label>
                    <Input value={newProvider.documentationUrl} onChange={e => setNewProvider(p => ({ ...p, documentationUrl: e.target.value }))} placeholder="https://docs.example.com" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Auth Header</Label>
                      <Input value={newProvider.authHeader} onChange={e => setNewProvider(p => ({ ...p, authHeader: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Auth Prefix</Label>
                      <Input value={newProvider.authPrefix} onChange={e => setNewProvider(p => ({ ...p, authPrefix: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Models Endpoint</Label>
                      <Input value={newProvider.modelsEndpoint} onChange={e => setNewProvider(p => ({ ...p, modelsEndpoint: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Chat Completions Endpoint</Label>
                      <Input value={newProvider.chatCompletionsEndpoint} onChange={e => setNewProvider(p => ({ ...p, chatCompletionsEndpoint: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <Label>Timeout (ms, optional)</Label>
                    <Input value={newProvider.timeoutMs} onChange={e => setNewProvider(p => ({ ...p, timeoutMs: e.target.value }))} placeholder="15000" />
                  </div>
                </>
              )}

              {/* Inline connection test */}
              <div className="border-t border-white/10 pt-3">
                <Button variant="outline" onClick={() => validateMutation.mutate()} disabled={!newProvider.baseUrl || validateMutation.isPending} className="w-full">
                  <Zap className={`w-4 h-4 mr-2 ${validateMutation.isPending ? 'animate-pulse' : ''}`} />
                  {validateMutation.isPending ? 'Testing connection...' : 'Test Connection'}
                </Button>

                {validation && (
                  <div className="mt-3 space-y-1.5 text-sm">
                    <ValidationRow ok={validation.urlSafe} label="URL is safe" />
                    <ValidationRow ok={validation.modelsReachable} label="Models endpoint reachable" detail={validation.modelsCount != null ? `${validation.modelsCount} models` : undefined} />
                    {validation.authValid !== null && <ValidationRow ok={validation.authValid} label="Authentication valid" />}
                    {validation.streamingWorks !== null && <ValidationRow ok={validation.streamingWorks} label="Streaming works" />}
                    {validation.errors.map((e, i) => <p key={i} className="text-red-400 text-xs flex items-center gap-1"><XCircle className="w-3 h-3" />{e}</p>)}
                    {validation.warnings.map((w, i) => <p key={i} className="text-yellow-400 text-xs flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{w}</p>)}
                  </div>
                )}
              </div>

              <Button
                onClick={() => createMutation.mutate(buildCreatePayload())}
                disabled={createMutation.isPending || !newProvider.name || !newProvider.slug || !newProvider.baseUrl}
                className="w-full">
                {createMutation.isPending ? 'Creating...' : 'Create Provider + Sync Models'}
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
                      {TYPE_BADGES[p.type] ?? '?'}
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
