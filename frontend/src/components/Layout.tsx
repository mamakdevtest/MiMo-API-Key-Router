import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, KeyRound, Settings, LogOut, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { logout } = useAuth();

  const nav = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/keys', label: 'API Keys', icon: KeyRound },
    { path: '/settings', label: 'Settings', icon: Settings },
    { path: '/docs', label: 'Docs', icon: BookOpen },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold">
              M
            </div>
            <span className="font-semibold text-lg">MiMo Router</span>
          </div>
          <nav className="flex items-center gap-1">
            {nav.map((item) => {
              const Icon = item.icon;
              const active = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
            <Button variant="ghost" size="sm" onClick={() => logout.mutate()} className="ml-2">
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </nav>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
