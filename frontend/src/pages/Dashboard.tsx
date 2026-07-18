import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, KeyRound, AlertTriangle, BatteryWarning, Clock, CheckCircle2, Coins, Zap, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { LiveFlowDiagram } from '@/components/LiveFlowDiagram';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from 'recharts';

const CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4'];

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

export function Dashboard() {
  const [period, setPeriod] = useState('24h');
  const { data: stats } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard, refetchInterval: 10000 });
  const { data: usage } = useQuery({ queryKey: ['usage', period], queryFn: () => api.usage(period), refetchInterval: 15000 });

  const cards = [
    { label: 'Gateway Status', value: stats?.gatewayStatus || 'unknown', icon: Activity, color: 'text-primary' },
    { label: 'Total Keys', value: stats?.totalKeys ?? 0, icon: KeyRound, color: 'text-foreground' },
    { label: 'Active Keys', value: stats?.activeKeys ?? 0, icon: CheckCircle2, color: 'text-green-500' },
    { label: 'Cooldown Keys', value: stats?.cooldownKeys ?? 0, icon: Clock, color: 'text-yellow-500' },
    { label: 'Exhausted Keys', value: stats?.exhaustedKeys ?? 0, icon: BatteryWarning, color: 'text-orange-500' },
    { label: 'Total Requests', value: usage?.totals.requests ?? stats?.requestsLast24h ?? 0, icon: BarChart3, color: 'text-blue-500' },
    { label: 'Total Tokens', value: formatTokens(usage?.totals.tokens ?? 0), icon: Zap, color: 'text-purple-500' },
    { label: 'Estimated Cost', value: formatCost(usage?.totals.cost ?? 0), icon: Coins, color: 'text-green-500' },
    { label: 'Ready Models', value: stats?.modelHealth.ready ?? 0, icon: CheckCircle2, color: 'text-green-500' },
    { label: 'Retest Models', value: stats?.modelHealth.retestRecommended ?? 0, icon: AlertTriangle, color: 'text-yellow-500' },
  ];

  const modelData = (usage?.byModel || []).map((m) => ({
    name: (m.model || 'unknown').replace('mimo-v2.5-', '').replace('mimo-v2.5', 'v2.5'),
    fullName: m.model,
    requests: m.requests,
    tokens: m.totalTokens,
    cost: m.estimatedCost,
    promptTokens: m.promptTokens,
    completionTokens: m.completionTokens,
    avgLatency: m.avgLatency,
  }));

  const keyData = (usage?.byKey || []).map((k) => ({
    keyId: k.keyId,
    label: k.label,
    requests: k.requests,
    tokens: k.totalTokens,
    cost: k.estimatedCost,
    promptTokens: k.promptTokens,
    completionTokens: k.completionTokens,
    avgLatency: k.avgLatency,
  }));

  const hourlyData = (usage?.hourly || []).map((h) => ({
    hour: h.hour ? (h.hour.split(' ')[1] || h.hour) : '--',
    requests: h.requests,
    tokens: h.totalTokens,
    cost: h.estimatedCost,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your provider-prefixed AI router.</p>
        </div>
        <div className="flex gap-1">
          {['1h', '24h', '7d', '30d'].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                period === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Live Diagram */}
      <LiveFlowDiagram />

      {/* Stat Cards */}
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

      <Card>
        <CardHeader>
          <CardTitle>Model health</CardTitle>
          <CardDescription>Latest benchmark result only. A result becomes stale after 24 hours; health is for visibility and catalog ordering, not routing.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-center sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['Ready', stats?.modelHealth.ready ?? 0, 'text-green-500'],
            ['Rate limited', stats?.modelHealth.rate_limited ?? 0, 'text-amber-500'],
            ['Untested', stats?.modelHealth.untested ?? 0, 'text-slate-400'],
            ['Stale', stats?.modelHealth.stale ?? 0, 'text-yellow-500'],
            ['Failed', stats?.modelHealth.failed ?? 0, 'text-red-500'],
            ['Inactive', stats?.modelHealth.inactive ?? 0, 'text-zinc-400'],
          ].map(([label, value, color]) => (
            <div key={label as string} className="rounded-lg bg-muted/30 p-3">
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Requests by Model */}
        <Card>
          <CardHeader>
            <CardTitle>Requests by Model</CardTitle>
            <CardDescription>How many requests each model received</CardDescription>
          </CardHeader>
          <CardContent>
            {modelData.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">No data for this period</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={modelData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Bar dataKey="requests" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Token Usage Pie */}
        <Card>
          <CardHeader>
            <CardTitle>Token Distribution</CardTitle>
            <CardDescription>Tokens used per model</CardDescription>
          </CardHeader>
          <CardContent>
            {modelData.length === 0 || modelData.every((m) => m.tokens === 0) ? (
              <p className="text-muted-foreground text-sm text-center py-8">No token data for this period</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={modelData.filter((m) => m.tokens > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="tokens"
                    nameKey="name"
                  >
                    {modelData.filter((m) => m.tokens > 0).map((_, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                  />
                  <Legend
                    formatter={(value) => value}
                    wrapperStyle={{ fontSize: '12px', color: 'hsl(var(--muted-foreground))' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Hourly Usage Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Requests Over Time</CardTitle>
          <CardDescription>Hourly request count and token usage</CardDescription>
        </CardHeader>
        <CardContent>
          {hourlyData.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No data for this period</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                  labelStyle={{ color: 'hsl(var(--foreground))' }}
                />
                <Legend wrapperStyle={{ fontSize: '12px', color: 'hsl(var(--muted-foreground))' }} />
                <Line yAxisId="left" type="monotone" dataKey="requests" stroke="#3b82f6" strokeWidth={2} dot={false} name="Requests" />
                <Line yAxisId="right" type="monotone" dataKey="tokens" stroke="#22c55e" strokeWidth={2} dot={false} name="Tokens" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Model Details Table */}
      {modelData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Model Usage Details</CardTitle>
            <CardDescription>Per-model breakdown with costs and latency</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">Model</th>
                    <th className="text-right py-2 px-2">Requests</th>
                    <th className="text-right py-2 px-2">Prompt Tokens</th>
                    <th className="text-right py-2 px-2">Completion Tokens</th>
                    <th className="text-right py-2 px-2">Total Tokens</th>
                    <th className="text-right py-2 px-2">Est. Cost</th>
                    <th className="text-right py-2 px-2">Avg Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {modelData.map((m, i) => (
                    <tr key={m.fullName} className="border-b last:border-0">
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <span className="font-medium">{m.fullName}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right">{m.requests.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">{formatTokens(m.promptTokens)}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">{formatTokens(m.completionTokens)}</td>
                      <td className="py-2 px-2 text-right font-medium">{formatTokens(m.tokens)}</td>
                      <td className="py-2 px-2 text-right text-green-500 font-medium">{formatCost(m.cost)}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">{m.avgLatency}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Key Details Table */}
      {keyData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>API Key Usage Details</CardTitle>
            <CardDescription>Per-key breakdown with costs and latency</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">Key Label</th>
                    <th className="text-right py-2 px-2">Requests</th>
                    <th className="text-right py-2 px-2">Prompt Tokens</th>
                    <th className="text-right py-2 px-2">Completion Tokens</th>
                    <th className="text-right py-2 px-2">Total Tokens</th>
                    <th className="text-right py-2 px-2">Est. Cost</th>
                    <th className="text-right py-2 px-2">Avg Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {keyData.map((k, i) => (
                    <tr key={k.keyId} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          <KeyRound className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">{k.label}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right">{k.requests.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">{formatTokens(k.promptTokens)}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">{formatTokens(k.completionTokens)}</td>
                      <td className="py-2 px-2 text-right font-medium">{formatTokens(k.tokens)}</td>
                      <td className="py-2 px-2 text-right text-green-500 font-medium">{formatCost(k.cost)}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">{k.avgLatency}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
