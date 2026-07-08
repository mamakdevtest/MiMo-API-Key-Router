import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, ArrowDown, Power, PowerOff, RotateCcw, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

export function Keys() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [newKey, setNewKey] = useState({ label: '', key: '', priority: 0, note: '' });

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkStartPriority, setBulkStartPriority] = useState(0);

  const { data: keys } = useQuery({ queryKey: ['keys'], queryFn: api.keys.list, refetchInterval: 5000 });

  const create = useMutation({
    mutationFn: api.keys.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] });
      setOpen(false);
      setNewKey({ label: '', key: '', priority: 0, note: '' });
      toast({ title: 'API key added' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const bulkCreate = useMutation({
    mutationFn: api.keys.bulkCreate,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['keys'] });
      setBulkOpen(false);
      setBulkText('');
      setBulkStartPriority(0);
      toast({ title: `Bulk imported ${res.count} keys successfully` });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const remove = useMutation({
    mutationFn: api.keys.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] });
      toast({ title: 'API key deleted' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const enable = useMutation({
    mutationFn: api.keys.enable,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['keys'] }),
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const disable = useMutation({
    mutationFn: api.keys.disable,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['keys'] }),
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const reset = useMutation({
    mutationFn: api.keys.reset,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['keys'] }),
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const move = useMutation({
    mutationFn: ({ id, direction }: { id: string; direction: 'up' | 'down' }) => api.keys.move(id, direction),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['keys'] }),
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">API Keys</h1>
          <p className="text-muted-foreground">Manage your MiMo API keys and failover order.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Bulk Import Dialog */}
          <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plus className="w-4 h-4 mr-2" />
                Bulk Import
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Bulk Import API Keys</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  // Parse keys
                  const lines = bulkText.split('\n');
                  const parsedKeys: Array<{ label: string; key: string }> = [];
                  let autoLabelCounter = 1;

                  for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    // Parse Google Sheets pasted column(s).
                    // If multiple columns, columns are separated by tabs ('\t').
                    // Otherwise, we split by commas.
                    if (trimmed.includes('\t')) {
                      const parts = trimmed.split('\t');
                      const label = parts[0].trim();
                      const key = parts[1].trim();
                      if (key) {
                        parsedKeys.push({ label, key });
                      }
                    } else if (trimmed.includes(',')) {
                      const parts = trimmed.split(',');
                      const label = parts[0].trim();
                      const key = parts[1].trim();
                      if (key) {
                        parsedKeys.push({ label, key });
                      }
                    } else {
                      // Single key per line
                      const keySuffix = trimmed.length > 8 ? trimmed.slice(-8) : trimmed;
                      parsedKeys.push({
                        label: `Imported Key ${autoLabelCounter++} (${keySuffix})`,
                        key: trimmed,
                      });
                    }
                  }

                  if (parsedKeys.length === 0) {
                    toast({ title: 'No valid keys found', variant: 'destructive' });
                    return;
                  }

                  bulkCreate.mutate({
                    keys: parsedKeys,
                    startPriority: bulkStartPriority,
                  });
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="bulkText">Paste Column(s) from Google Sheets / Excel</Label>
                  <textarea
                    id="bulkText"
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    required
                    placeholder="sk-mimo-key-1&#10;sk-mimo-key-2&#10;&#10;OR&#10;&#10;Key Label 1&#9;sk-mimo-key-1&#10;Key Label 2&#9;sk-mimo-key-2"
                    rows={8}
                    className="flex min-h-[160px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <p className="text-xs text-muted-foreground">
                    Supports pasting a single column of keys, or two columns (Label and Key) separated by tabs.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bulkPriority">Insert Priority (0 = top)</Label>
                  <Input
                    id="bulkPriority"
                    type="number"
                    min={0}
                    value={bulkStartPriority}
                    onChange={(e) => setBulkStartPriority(parseInt(e.target.value) || 0)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    The imported keys will occupy sequential priorities starting from this number, shifting other keys down.
                  </p>
                </div>
                <Button type="submit" className="w-full" disabled={bulkCreate.isPending}>
                  {bulkCreate.isPending ? 'Importing...' : `Import ${bulkText.split('\n').filter(l => l.trim()).length} Keys`}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Key
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add MiMo API Key</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate(newKey);
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="label">Label</Label>
                <Input id="label" value={newKey.label} onChange={(e) => setNewKey({ ...newKey, label: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="key">MiMo API Key</Label>
                <Input id="key" type="password" value={newKey.key} onChange={(e) => setNewKey({ ...newKey, key: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="priority">Priority (0 = highest)</Label>
                <Input id="priority" type="number" min={0} value={newKey.priority} onChange={(e) => setNewKey({ ...newKey, priority: parseInt(e.target.value) })} required />
              </div>
              <Button type="submit" className="w-full" disabled={create.isPending}>
                {create.isPending ? 'Saving...' : 'Save Key'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>

      <Card>
        <CardHeader>
          <CardTitle>Key List</CardTitle>
          <CardDescription>Keys are tried in priority order from top to bottom.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2">#</th>
                  <th className="text-left py-2 px-2">Label</th>
                  <th className="text-left py-2 px-2">Key</th>
                  <th className="text-left py-2 px-2">Status</th>
                  <th className="text-left py-2 px-2">Last Used</th>
                  <th className="text-left py-2 px-2">Last Error</th>
                  <th className="text-right py-2 px-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(keys || []).map((key, index) => (
                  <tr key={key.id} className="border-b last:border-0">
                    <td className="py-3 px-2">{index + 1}</td>
                    <td className="py-3 px-2 font-medium">{key.label}</td>
                    <td className="py-3 px-2 font-mono text-muted-foreground">{key.maskedKey}</td>
                    <td className="py-3 px-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[key.status] || ''}`}>
                        {key.status}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-muted-foreground">
                      {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'}
                    </td>
                    <td className="py-3 px-2 text-muted-foreground">
                      {key.lastErrorCode ? `${key.lastErrorCode} (${new Date(key.lastErrorAt!).toLocaleTimeString()})` : '-'}
                    </td>
                    <td className="py-3 px-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => move.mutate({ id: key.id, direction: 'up' })} disabled={index === 0}>
                          <ArrowUp className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => move.mutate({ id: key.id, direction: 'down' })} disabled={index === (keys?.length || 0) - 1}>
                          <ArrowDown className="w-4 h-4" />
                        </Button>
                        {key.status === 'disabled' || key.status === 'invalid' || key.status === 'exhausted' ? (
                          <Button variant="ghost" size="icon" onClick={() => enable.mutate(key.id)}>
                            <Power className="w-4 h-4 text-green-500" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="icon" onClick={() => disable.mutate(key.id)}>
                            <PowerOff className="w-4 h-4 text-red-500" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => reset.mutate(key.id)}>
                          <RotateCcw className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => remove.mutate(key.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
