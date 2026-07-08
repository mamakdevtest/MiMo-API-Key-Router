import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

const statusColors: Record<number, string> = {
  200: 'text-green-500',
  201: 'text-green-500',
  400: 'text-yellow-500',
  401: 'text-red-500',
  403: 'text-red-500',
  404: 'text-yellow-500',
  429: 'text-orange-500',
  500: 'text-red-500',
  502: 'text-red-500',
  503: 'text-red-500',
};

export function Logs() {
  const [page, setPage] = useState(0);
  const limit = 50;

  const { data: logs, isLoading } = useQuery({
    queryKey: ['logs', page],
    queryFn: () => api.logs.list(limit, page * limit),
    refetchInterval: 10000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Request Logs</h1>
          <p className="text-muted-foreground">Recent proxied requests with status and latency.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page + 1}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={!logs || logs.length < limit}>
            Next
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Request History</CardTitle>
          <CardDescription>Showing up to {limit} requests per page. Auto-refreshes every 10 seconds.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : !logs || logs.length === 0 ? (
            <p className="text-muted-foreground text-sm">No requests logged yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">Time</th>
                    <th className="text-left py-2 px-2">Route</th>
                    <th className="text-left py-2 px-2">Model</th>
                    <th className="text-left py-2 px-2">Status</th>
                    <th className="text-right py-2 px-2">Latency</th>
                    <th className="text-center py-2 px-2">Stream</th>
                    <th className="text-center py-2 px-2">Fallback</th>
                    <th className="text-left py-2 px-2">Client IP</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b last:border-0">
                      <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="py-2 px-2 font-mono text-xs">{log.route}</td>
                      <td className="py-2 px-2 text-muted-foreground">{log.model || '-'}</td>
                      <td className="py-2 px-2">
                        <span className={`font-medium ${statusColors[log.statusCode || 0] || 'text-foreground'}`}>
                          {log.statusCode || '-'}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right text-muted-foreground">
                        {log.latencyMs < 1000 ? `${Math.round(log.latencyMs)}ms` : `${(log.latencyMs / 1000).toFixed(1)}s`}
                      </td>
                      <td className="py-2 px-2 text-center">
                        {log.streaming ? (
                          <span className="text-blue-500 text-xs">SSE</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-center">
                        {log.fallback ? (
                          <span className="text-yellow-500 text-xs">Yes</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">No</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-muted-foreground font-mono text-xs">
                        {log.clientIp || '-'}
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
