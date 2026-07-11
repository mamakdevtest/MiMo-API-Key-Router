import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Plus, Trash2, ArrowUp, ArrowDown, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export function Routes() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newRoute, setNewRoute] = useState({
    publicModelId: '',
    displayName: '',
    description: '',
    routeKind: 'chat' as const,
    isPublic: true,
  });

  const { data: routes, isLoading } = useQuery({
    queryKey: ['model-routes'],
    queryFn: () => api.modelRoutes.list(),
    refetchInterval: 30000,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.modelRoutes.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-routes'] });
      setShowCreate(false);
      toast({ title: 'Route created' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.modelRoutes.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['model-routes'] }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      enabled ? api.modelRoutes.enable(id) : api.modelRoutes.disable(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['model-routes'] }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Routes</h1>
          <p className="text-muted-foreground">Map public model IDs to provider targets with failover.</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />Add Route</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Route</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Public Model ID</Label>
                <Input value={newRoute.publicModelId} onChange={e => setNewRoute(p => ({ ...p, publicModelId: e.target.value }))} placeholder="coding-pro" />
              </div>
              <div>
                <Label>Display Name</Label>
                <Input value={newRoute.displayName} onChange={e => setNewRoute(p => ({ ...p, displayName: e.target.value }))} placeholder="Coding Pro" />
              </div>
              <div>
                <Label>Description</Label>
                <Input value={newRoute.description} onChange={e => setNewRoute(p => ({ ...p, description: e.target.value }))} placeholder="Best model for coding tasks" />
              </div>
              <div>
                <Label>Route Kind</Label>
                <select className="w-full mt-1 p-2 rounded-md bg-background border" value={newRoute.routeKind}
                  onChange={e => setNewRoute(p => ({ ...p, routeKind: e.target.value as any }))}>
                  <option value="chat">Chat</option>
                  <option value="text_completion">Text Completion</option>
                  <option value="embedding">Embedding</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={newRoute.isPublic} onCheckedChange={v => setNewRoute(p => ({ ...p, isPublic: v }))} />
                <Label>Public (visible in /v1/models)</Label>
              </div>
              <Button onClick={() => createMutation.mutate(newRoute)} disabled={createMutation.isPending} className="w-full">
                {createMutation.isPending ? 'Creating...' : 'Create Route'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-4">
        {(routes ?? []).map((route: any) => (
          <Card key={route.id} className="hover:border-white/20 transition-colors">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <GitBranch className="w-5 h-5 text-blue-400" />
                  <div>
                    <CardTitle className="text-base font-mono">{route.publicModelId}</CardTitle>
                    <CardDescription>{route.displayName || route.description || route.routeKind}</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-1 rounded ${route.isPublic ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/15 text-gray-400'}`}>
                    {route.isPublic ? 'Public' : 'Private'}
                  </span>
                  <span className="text-xs px-2 py-1 rounded bg-blue-500/15 text-blue-400">{route.routeKind}</span>
                  <Switch checked={route.enabled} onCheckedChange={(enabled) => toggleMutation.mutate({ id: route.id, enabled })} />
                  <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(route.id)}>
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-sm">
                <div className="text-muted-foreground mb-2">Targets ({route.targets?.length ?? 0}):</div>
                {route.targets?.length > 0 ? (
                  <div className="space-y-2">
                    {route.targets.map((t: any, i: number) => (
                      <div key={t.id} className="flex items-center gap-3 bg-muted/20 rounded-lg p-2">
                        <span className="text-xs font-mono text-muted-foreground w-6">#{i + 1}</span>
                        <span className="font-medium text-sm">{t.providerName}</span>
                        <span className="text-muted-foreground text-xs">→</span>
                        <span className="font-mono text-xs">{t.upstreamModelId}</span>
                        {t.supportsTools && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">Tools</span>}
                        {t.supportsVision && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">Vision</span>}
                        {!t.enabled && <XCircle className="w-3 h-3 text-red-400" />}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-muted-foreground text-sm py-4 text-center">No targets configured. Edit this route to add provider targets.</div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {(!routes || routes.length === 0) && (
        <Card>
          <CardContent className="text-center py-12">
            <GitBranch className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No routes configured</h3>
            <p className="text-muted-foreground mb-4">Create a route to map public model IDs to provider targets.</p>
            <Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-2" />Add Route</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
