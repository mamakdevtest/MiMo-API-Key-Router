import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Plus, Power, PowerOff, RefreshCw, Trash2, Upload } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

const statusColors: Record<string, string> = {
  active: 'bg-green-500/10 text-green-500',
  cooldown: 'bg-yellow-500/10 text-yellow-500',
  exhausted: 'bg-orange-500/10 text-orange-500',
  disabled: 'bg-red-500/10 text-red-500',
  invalid: 'bg-red-500/10 text-red-500',
};

function getProviderCopy(type?: string) {
  if (type === 'mimo') {
    return {
      title: 'MiMo',
      placeholder: 'sk-mimo-...',
      baseUrlHint: 'https://api.xiaomimimo.com/v1',
    };
  }

  return {
    title: 'Featherless',
    placeholder: 'sk-featherless-...',
    baseUrlHint: 'https://api.featherless.ai',
  };
}

function parseBulkCredentials(input: string) {
  const lines = input.split('\n');
  const parsed: Array<{ name: string; secret: string }> = [];
  let counter = 1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.includes('\t')) {
      const [name, secret] = trimmed.split('\t');
      if (secret?.trim()) parsed.push({ name: name.trim() || `Credential ${counter++}`, secret: secret.trim() });
      continue;
    }

    if (trimmed.includes(',')) {
      const [name, secret] = trimmed.split(',');
      if (secret?.trim()) parsed.push({ name: name.trim() || `Credential ${counter++}`, secret: secret.trim() });
      continue;
    }

    const suffix = trimmed.length > 8 ? trimmed.slice(-8) : trimmed;
    parsed.push({ name: `${counter}. ${suffix}`, secret: trimmed });
    counter += 1;
  }

  return parsed;
}

export function ProviderDetails() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [newCredential, setNewCredential] = useState({ name: '', secret: '', priority: 0 });
  const [bulkText, setBulkText] = useState('');
  const [bulkStartPriority, setBulkStartPriority] = useState(0);

  const { data: provider, isLoading: providerLoading } = useQuery({
    queryKey: ['provider', id],
    queryFn: () => api.providers.get(id),
    enabled: !!id,
  });

  const { data: credentials, isLoading: credentialsLoading } = useQuery({
    queryKey: ['provider-credentials', id],
    queryFn: () => api.providers.credentials.list(id),
    enabled: !!id,
    refetchInterval: 10000,
  });

  const providerCopy = useMemo(() => getProviderCopy(provider?.type), [provider?.type]);

  const refreshProviderQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['providers'] });
    queryClient.invalidateQueries({ queryKey: ['provider', id] });
    queryClient.invalidateQueries({ queryKey: ['provider-credentials', id] });
  };

  const createCredential = useMutation({
    mutationFn: (payload: typeof newCredential) => api.providers.credentials.create(id, payload),
    onSuccess: () => {
      refreshProviderQueries();
      setCreateOpen(false);
      setNewCredential({ name: '', secret: '', priority: 0 });
      toast({ title: `${providerCopy.title} key added` });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const bulkCreate = useMutation({
    mutationFn: (payload: { credentials: Array<{ name: string; secret: string }>; startPriority?: number }) =>
      api.providers.credentials.bulkCreate(id, payload),
    onSuccess: (result) => {
      refreshProviderQueries();
      setBulkOpen(false);
      setBulkText('');
      setBulkStartPriority(0);
      toast({ title: `${result.count} ${providerCopy.title} keys imported` });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const removeCredential = useMutation({
    mutationFn: (credentialId: string) => api.providers.credentials.delete(id, credentialId),
    onSuccess: () => {
      refreshProviderQueries();
      toast({ title: 'Credential deleted' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const resetCredential = useMutation({
    mutationFn: (credentialId: string) => api.providers.credentials.reset(id, credentialId),
    onSuccess: () => refreshProviderQueries(),
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const setEnabled = useMutation({
    mutationFn: ({ credentialId, enabled }: { credentialId: string; enabled: boolean }) =>
      enabled ? api.providers.credentials.enable(id, credentialId) : api.providers.credentials.disable(id, credentialId),
    onSuccess: () => refreshProviderQueries(),
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const testProvider = useMutation({
    mutationFn: () => api.providers.test(id),
    onSuccess: (result) => {
      toast({
        title: result.success ? 'Provider test passed' : 'Provider test failed',
        description: result.message,
        variant: result.success ? 'default' : 'destructive',
      });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const syncModels = useMutation({
    mutationFn: () => api.providers.syncModels(id),
    onSuccess: (result) => {
      refreshProviderQueries();
      toast({ title: 'Model sync complete', description: `${result.added} added, ${result.updated} updated, ${result.removed} removed` });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  if (providerLoading || credentialsLoading) {
    return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (!provider) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <p className="text-lg font-semibold">Provider not found</p>
          <Button asChild variant="outline">
            <Link to="/providers"><ArrowLeft className="w-4 h-4 mr-2" />Back to providers</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Button asChild variant="ghost" size="sm" className="px-0">
            <Link to="/providers"><ArrowLeft className="w-4 h-4 mr-2" />Back to providers</Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{provider.name}</h1>
            <p className="text-muted-foreground">
              {providerCopy.title} provider keys live only here. These keys are used only for this provider, while the router gateway key stays global.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => testProvider.mutate()} disabled={testProvider.isPending}>
            <CheckCircle2 className="w-4 h-4 mr-2" />Test
          </Button>
          <Button variant="outline" onClick={() => syncModels.mutate()} disabled={syncModels.isPending}>
            <RefreshCw className={`w-4 h-4 mr-2 ${syncModels.isPending ? 'animate-spin' : ''}`} />Sync Models
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Provider Type</CardTitle>
            <CardDescription>Isolated upstream configuration</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-medium capitalize">{provider.type}</p>
            <p className="text-muted-foreground break-all">{provider.baseUrl}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Credential Pool</CardTitle>
            <CardDescription>Only this provider can use these API keys</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-bold">{credentials?.length ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Router Access</CardTitle>
            <CardDescription>Shared client-facing entrypoint</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Clients do not use these upstream keys directly.</p>
            <p>They call the router with the single global gateway key.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{providerCopy.title} Credentials</CardTitle>
            <CardDescription>
              Add one key manually or bulk import multiple keys for this provider. Expected base URL: {providerCopy.baseUrlHint}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
              <DialogTrigger asChild>
                <Button variant="outline"><Upload className="w-4 h-4 mr-2" />Bulk Import</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                  <DialogTitle>Bulk import {providerCopy.title} keys</DialogTitle>
                </DialogHeader>
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const parsed = parseBulkCredentials(bulkText);
                    if (parsed.length === 0) {
                      toast({ title: 'No valid credentials found', variant: 'destructive' });
                      return;
                    }

                    bulkCreate.mutate({
                      credentials: parsed,
                      startPriority: bulkStartPriority,
                    });
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="bulkText">Paste keys or label + key columns</Label>
                    <textarea
                      id="bulkText"
                      value={bulkText}
                      onChange={(event) => setBulkText(event.target.value)}
                      placeholder={`${providerCopy.placeholder}\n\nOR\n\nMain Account\t${providerCopy.placeholder}`}
                      rows={8}
                      className="flex min-h-[180px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bulkPriority">Start priority</Label>
                    <Input
                      id="bulkPriority"
                      type="number"
                      min={0}
                      value={bulkStartPriority}
                      onChange={(event) => setBulkStartPriority(parseInt(event.target.value, 10) || 0)}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={bulkCreate.isPending}>
                    {bulkCreate.isPending ? 'Importing...' : 'Import provider keys'}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="w-4 h-4 mr-2" />Add Key</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add {providerCopy.title} key</DialogTitle>
                </DialogHeader>
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    createCredential.mutate(newCredential);
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="name">Label</Label>
                    <Input id="name" value={newCredential.name} onChange={(event) => setNewCredential((current) => ({ ...current, name: event.target.value }))} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="secret">{providerCopy.title} API Key</Label>
                    <Input id="secret" type="password" placeholder={providerCopy.placeholder} value={newCredential.secret} onChange={(event) => setNewCredential((current) => ({ ...current, secret: event.target.value }))} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="priority">Priority</Label>
                    <Input id="priority" type="number" min={0} value={newCredential.priority} onChange={(event) => setNewCredential((current) => ({ ...current, priority: parseInt(event.target.value, 10) || 0 }))} required />
                  </div>
                  <Button type="submit" className="w-full" disabled={createCredential.isPending}>
                    {createCredential.isPending ? 'Saving...' : 'Save provider key'}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {!credentials || credentials.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No keys added yet. Choose single add or bulk import and they will belong only to this provider.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">Priority</th>
                    <th className="text-left py-2 px-2">Label</th>
                    <th className="text-left py-2 px-2">Key</th>
                    <th className="text-left py-2 px-2">Status</th>
                    <th className="text-left py-2 px-2">Last Used</th>
                    <th className="text-right py-2 px-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {credentials.map((credential: any) => (
                    <tr key={credential.id} className="border-b last:border-0">
                      <td className="py-3 px-2">{credential.priority}</td>
                      <td className="py-3 px-2 font-medium">{credential.name}</td>
                      <td className="py-3 px-2 font-mono text-muted-foreground">{credential.maskedSecret}</td>
                      <td className="py-3 px-2">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[credential.status] || ''}`}>
                          {credential.status}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-muted-foreground">
                        {credential.lastUsedAt ? new Date(credential.lastUsedAt).toLocaleString() : 'Never'}
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex items-center justify-end gap-1">
                          {credential.status === 'disabled' || credential.status === 'invalid' || credential.status === 'exhausted' ? (
                            <Button variant="ghost" size="icon" onClick={() => setEnabled.mutate({ credentialId: credential.id, enabled: true })}>
                              <Power className="w-4 h-4 text-green-500" />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="icon" onClick={() => setEnabled.mutate({ credentialId: credential.id, enabled: false })}>
                              <PowerOff className="w-4 h-4 text-red-500" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" onClick={() => resetCredential.mutate(credential.id)}>
                            <RefreshCw className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => removeCredential.mutate(credential.id)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
