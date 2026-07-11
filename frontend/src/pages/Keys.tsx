import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, KeyRound, RefreshCw, Server, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export function Keys() {
  const { toast } = useToast();
  const [gatewayKey, setGatewayKey] = useState<string | null>(null);

  const { data: providers } = useQuery({
    queryKey: ['providers'],
    queryFn: api.providers.list,
    refetchInterval: 30000,
  });

  const { data: tempKeys } = useQuery({
    queryKey: ['temp-keys'],
    queryFn: api.tempKeys.list,
    refetchInterval: 10000,
  });

  const rotate = useMutation({
    mutationFn: api.rotateGatewayKey,
    onSuccess: (data) => {
      setGatewayKey(data.key);
      toast({ title: 'Gateway key rotated' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const configuredProviders = providers ?? [];
  const activeTempKeys = (tempKeys ?? []).filter((item) => item.isActive && !item.isExpired);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Gateway Keys</h1>
        <p className="text-muted-foreground">
          Upstream provider keys are isolated per provider. Clients only need the single AI Provider Router gateway key.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Main Router Key</CardTitle>
            <CardDescription>
              This is the only key your app or client should use. The router picks MiMo or Featherless provider keys automatically behind the scenes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {gatewayKey ? (
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="font-mono break-all text-sm">{gatewayKey}</p>
                <p className="mt-2 text-xs text-destructive">Copy this now. It will not be shown again.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Rotate the gateway key when you want to issue a new single access key for all provider routes.
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" onClick={() => rotate.mutate()} disabled={rotate.isPending}>
                <RefreshCw className={`w-4 h-4 mr-2 ${rotate.isPending ? 'animate-spin' : ''}`} />
                Rotate Gateway Key
              </Button>
              <Button asChild variant="outline">
                <Link to="/temp-keys"><Timer className="w-4 h-4 mr-2" />Manage Temporary Keys</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Gateway Summary</CardTitle>
            <CardDescription>Single entrypoint, multiple isolated providers</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-muted/30 p-3">
              <p className="text-2xl font-bold">{configuredProviders.length}</p>
              <p className="text-sm text-muted-foreground">Configured providers</p>
            </div>
            <div className="rounded-lg bg-muted/30 p-3">
              <p className="text-2xl font-bold">{activeTempKeys.length}</p>
              <p className="text-sm text-muted-foreground">Active temporary gateway keys</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Provider Key Pools</CardTitle>
          <CardDescription>
            MiMo and Featherless stay fully separate. Open a provider to manage only that provider's own API keys.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {configuredProviders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No providers configured yet. Add a provider first, then load that provider's own key screen.
            </div>
          ) : (
            configuredProviders.map((provider: any) => (
              <div key={provider.id} className="flex items-center justify-between rounded-xl border border-border bg-card/40 p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-primary" />
                    <p className="font-medium">{provider.name}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {provider.type} · {provider.credentialCount ?? 0} active keys
                  </p>
                </div>
                <Button asChild variant="outline">
                  <Link to={`/providers/${provider.id}`}>
                    <KeyRound className="w-4 h-4 mr-2" />Open Provider Keys <ArrowRight className="w-4 h-4 ml-2" />
                  </Link>
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
