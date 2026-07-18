import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, KeyRound, Server, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

export function Keys() {
  const { data: providers } = useQuery({
    queryKey: ['providers'],
    queryFn: api.providers.list,
    refetchInterval: 30000,
  });

  const configuredProviders = providers ?? [];

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
              This is the only key your app or client should use. It is supplied as `GATEWAY_KEY` at deployment time and the router selects provider credentials internally.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-green-500/20 bg-green-500/5 p-4 text-sm">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-green-400" />
              <div>
                <p className="font-medium">One permanent router key</p>
                <p className="mt-1 text-muted-foreground">Temporary keys and dashboard rotation are disabled. Change `GATEWAY_KEY` in your deployment environment only when you intentionally replace client access.</p>
              </div>
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
              <p className="text-2xl font-bold">1</p>
              <p className="text-sm text-muted-foreground">Accepted router key</p>
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
