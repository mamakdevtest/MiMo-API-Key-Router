import { useQuery } from '@tanstack/react-query';
import { Activity, KeyRound, AlertTriangle, BatteryWarning, Clock, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

export function Dashboard() {
  const { data: stats } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard, refetchInterval: 10000 });

  const cards = [
    { label: 'Gateway Status', value: stats?.gatewayStatus || 'unknown', icon: Activity, color: 'text-primary' },
    { label: 'Total Keys', value: stats?.totalKeys ?? 0, icon: KeyRound, color: 'text-foreground' },
    { label: 'Active Keys', value: stats?.activeKeys ?? 0, icon: CheckCircle2, color: 'text-green-500' },
    { label: 'Cooldown Keys', value: stats?.cooldownKeys ?? 0, icon: Clock, color: 'text-yellow-500' },
    { label: 'Exhausted Keys', value: stats?.exhaustedKeys ?? 0, icon: BatteryWarning, color: 'text-orange-500' },
    { label: 'Requests (24h)', value: stats?.requestsLast24h ?? 0, icon: Activity, color: 'text-blue-500' },
    { label: 'Success Rate', value: `${stats?.successRate ?? 100}%`, icon: CheckCircle2, color: 'text-green-500' },
    { label: 'Degraded', value: (stats?.totalKeys ?? 0) - (stats?.activeKeys ?? 0), icon: AlertTriangle, color: 'text-red-500' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your MiMo API key router.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
                <Icon className={`h-4 w-4 ${card.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
