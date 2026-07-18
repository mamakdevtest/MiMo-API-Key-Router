import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export function Settings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings.get });

  const [form, setForm] = useState({
    cooldown429Seconds: 60,
    cooldown5xxSeconds: 60,
    cooldownTimeoutSeconds: 60,
    requestTimeoutSeconds: 120,
    ipAllowlist: '',
  });

  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [gatewayKey, setGatewayKey] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setForm({
        cooldown429Seconds: settings.cooldown429Seconds,
        cooldown5xxSeconds: settings.cooldown5xxSeconds,
        cooldownTimeoutSeconds: settings.cooldownTimeoutSeconds,
        requestTimeoutSeconds: settings.requestTimeoutSeconds,
        ipAllowlist: settings.ipAllowlist,
      });
    }
  }, [settings]);

  const updateSettings = useMutation({
    mutationFn: api.settings.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast({ title: 'Settings saved' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const rotate = useMutation({
    mutationFn: api.rotateGatewayKey,
    onSuccess: (data) => {
      setGatewayKey(data.key);
      toast({ title: 'Router key rotated' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const changePassword = useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) => api.changePassword(current, next),
    onSuccess: () => {
      setPasswords({ current: '', new: '', confirm: '' });
      toast({ title: 'Password changed. Please log in again.' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Configure router cooldowns, timeouts, IP allowlist, and admin access.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cooldown & Timeout</CardTitle>
          <CardDescription>Adjust provider key failover behavior durations in seconds.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>429 Cooldown (s)</Label>
              <Input type="number" value={form.cooldown429Seconds} onChange={(e) => setForm({ ...form, cooldown429Seconds: parseInt(e.target.value, 10) || 60 })} />
            </div>
            <div className="space-y-2">
              <Label>5xx Cooldown (s)</Label>
              <Input type="number" value={form.cooldown5xxSeconds} onChange={(e) => setForm({ ...form, cooldown5xxSeconds: parseInt(e.target.value, 10) || 60 })} />
            </div>
            <div className="space-y-2">
              <Label>Timeout Cooldown (s)</Label>
              <Input type="number" value={form.cooldownTimeoutSeconds} onChange={(e) => setForm({ ...form, cooldownTimeoutSeconds: parseInt(e.target.value, 10) || 60 })} />
            </div>
            <div className="space-y-2">
              <Label>Request Timeout (s)</Label>
              <Input type="number" value={form.requestTimeoutSeconds} onChange={(e) => setForm({ ...form, requestTimeoutSeconds: parseInt(e.target.value, 10) || 120 })} />
            </div>
          </div>
          <Button onClick={() => updateSettings.mutate(form)} disabled={updateSettings.isPending}>Save Settings</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>IP Allowlist</CardTitle>
          <CardDescription>Leave empty to allow any IP with a valid router key. Supports single IP, CIDR, IPv4, IPv6, comma-separated.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <textarea
            className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={form.ipAllowlist}
            onChange={(e) => setForm({ ...form, ipAllowlist: e.target.value })}
            placeholder="192.168.1.50&#10;88.245.10.0/24&#10;2001:db8::/32"
          />
          <Button onClick={() => updateSettings.mutate({ ipAllowlist: form.ipAllowlist })} disabled={updateSettings.isPending}>Save Allowlist</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Router API Key</CardTitle>
          <CardDescription>Rotate the main client-facing router key. The old key will stop working immediately.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {gatewayKey && (
            <div className="p-3 rounded bg-muted">
              <p className="text-sm font-mono break-all">{gatewayKey}</p>
              <p className="text-xs text-destructive mt-1">Copy this now. It will not be shown again.</p>
            </div>
          )}
          <Button variant="destructive" onClick={() => rotate.mutate()} disabled={rotate.isPending}>Rotate Router Key</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Admin Password</CardTitle>
          <CardDescription>Change your admin password.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Current Password</Label>
            <Input type="password" value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>New Password</Label>
            <Input type="password" value={passwords.new} onChange={(e) => setPasswords({ ...passwords, new: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Confirm New Password</Label>
            <Input type="password" value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} />
          </div>
          <Button
            onClick={() => {
              if (passwords.new !== passwords.confirm) {
                toast({ title: 'Error', description: 'Passwords do not match', variant: 'destructive' });
                return;
              }
              changePassword.mutate({ current: passwords.current, next: passwords.new });
            }}
            disabled={changePassword.isPending}
          >
            Change Password
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
