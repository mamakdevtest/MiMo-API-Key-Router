import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Ban, RotateCcw, Copy, Check, Clock, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export function TempKeys() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [newKey, setNewKey] = useState({ label: '', expiresInMinutes: 60, maxRequests: '' });
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: keys } = useQuery({ queryKey: ['temp-keys'], queryFn: api.tempKeys.list, refetchInterval: 10000 });

  const create = useMutation({
    mutationFn: (data: { label: string; expiresInMinutes?: number; maxRequests?: number }) =>
      api.tempKeys.create(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['temp-keys'] });
      setGeneratedKey(data.key);
      setNewKey({ label: '', expiresInMinutes: 60, maxRequests: '' });
      toast({ title: 'Temporary key created' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const remove = useMutation({
    mutationFn: api.tempKeys.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['temp-keys'] });
      toast({ title: 'Temporary key deleted' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const revoke = useMutation({
    mutationFn: api.tempKeys.revoke,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['temp-keys'] }),
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const reactivate = useMutation({
    mutationFn: api.tempKeys.reactivate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['temp-keys'] }),
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Temporary API Keys</h1>
          <p className="text-muted-foreground">Generate time-limited or request-limited gateway keys for testing.</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setGeneratedKey(null); }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Generate Key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Generate Temporary API Key</DialogTitle>
            </DialogHeader>

            {generatedKey ? (
              <div className="space-y-4">
                <div className="p-4 rounded-md bg-muted space-y-2">
                  <p className="text-xs text-muted-foreground">Your temporary API key (copy now, won't be shown again):</p>
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono break-all flex-1">{generatedKey}</code>
                    <Button variant="ghost" size="icon" onClick={() => copyKey(generatedKey)}>
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                <Button className="w-full" onClick={() => { setOpen(false); setGeneratedKey(null); }}>
                  Done
                </Button>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  create.mutate({
                    label: newKey.label,
                    expiresInMinutes: newKey.expiresInMinutes || undefined,
                    maxRequests: newKey.maxRequests ? parseInt(newKey.maxRequests) : undefined,
                  });
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="label">Label</Label>
                  <Input
                    id="label"
                    value={newKey.label}
                    onChange={(e) => setNewKey({ ...newKey, label: e.target.value })}
                    placeholder="e.g. Testing key, temporary access"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expires">Expires in (minutes)</Label>
                  <Input
                    id="expires"
                    type="number"
                    min={1}
                    max={43200}
                    value={newKey.expiresInMinutes}
                    onChange={(e) => setNewKey({ ...newKey, expiresInMinutes: parseInt(e.target.value) || 0 })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave empty for no expiry. Common: 60 (1h), 1440 (1 day), 10080 (7 days).
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxRequests">Max requests (optional)</Label>
                  <Input
                    id="maxRequests"
                    type="number"
                    min={1}
                    max={100000}
                    value={newKey.maxRequests}
                    onChange={(e) => setNewKey({ ...newKey, maxRequests: e.target.value })}
                    placeholder="Leave empty for unlimited"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={create.isPending}>
                  {create.isPending ? 'Generating...' : 'Generate Key'}
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active Temporary Keys</CardTitle>
          <CardDescription>These keys work like the main gateway key but can expire or have request limits.</CardDescription>
        </CardHeader>
        <CardContent>
          {!keys || keys.length === 0 ? (
            <p className="text-muted-foreground text-sm">No temporary keys yet. Click "Generate Key" to create one.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">Label</th>
                    <th className="text-left py-2 px-2">Key</th>
                    <th className="text-left py-2 px-2">Status</th>
                    <th className="text-left py-2 px-2">Expires</th>
                    <th className="text-left py-2 px-2">Requests</th>
                    <th className="text-left py-2 px-2">Created</th>
                    <th className="text-right py-2 px-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => {
                    const isExpired = key.isExpired;
                    const isRevoked = !key.isActive;
                    const statusColor = isExpired
                      ? 'bg-red-500/10 text-red-500'
                      : isRevoked
                        ? 'bg-orange-500/10 text-orange-500'
                        : 'bg-green-500/10 text-green-500';
                    const statusText = isExpired ? 'expired' : isRevoked ? 'revoked' : 'active';

                    return (
                      <tr key={key.id} className="border-b last:border-0">
                        <td className="py-3 px-2 font-medium">{key.label}</td>
                        <td className="py-3 px-2 font-mono text-muted-foreground text-xs">{key.maskedKey}</td>
                        <td className="py-3 px-2">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor}`}>
                            {statusText}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-muted-foreground">
                          {key.expiresAt ? (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {isExpired ? 'Expired' : new Date(key.expiresAt).toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Never</span>
                          )}
                        </td>
                        <td className="py-3 px-2 text-muted-foreground">
                          {key.maxRequests ? (
                            <span className="flex items-center gap-1">
                              <Zap className="w-3 h-3" />
                              {key.requestCount}/{key.maxRequests}
                            </span>
                          ) : (
                            <span>{key.requestCount}</span>
                          )}
                        </td>
                        <td className="py-3 px-2 text-muted-foreground">
                          {new Date(key.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {!isExpired && (
                              key.isActive ? (
                                <Button variant="ghost" size="icon" onClick={() => revoke.mutate(key.id)} title="Revoke">
                                  <Ban className="w-4 h-4 text-orange-500" />
                                </Button>
                              ) : (
                                <Button variant="ghost" size="icon" onClick={() => reactivate.mutate(key.id)} title="Reactivate">
                                  <RotateCcw className="w-4 h-4 text-green-500" />
                                </Button>
                              )
                            )}
                            <Button variant="ghost" size="icon" onClick={() => remove.mutate(key.id)} title="Delete">
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How Temporary Keys Work</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Temporary keys work exactly like the main gateway key. Clients use them with:</p>
          <pre className="p-3 rounded-md bg-muted text-xs font-mono">
            Authorization: Bearer {'<'}TEMPORARY_KEY{'>'}
          </pre>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Expiry:</strong> Key stops working after the specified time</li>
            <li><strong>Request limit:</strong> Key stops working after N requests</li>
            <li><strong>Revoke:</strong> Immediately invalidates the key without deleting it</li>
            <li><strong>Use cases:</strong> Testing, sharing access temporarily, debugging client configs</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
