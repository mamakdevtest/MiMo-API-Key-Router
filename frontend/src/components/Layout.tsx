import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, KeyRound, Settings, LogOut, BookOpen, ScrollText, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { motion, AnimatePresence } from 'framer-motion';

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { logout } = useAuth();

  const nav = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/keys', label: 'API Keys', icon: KeyRound },
    { path: '/temp-keys', label: 'Temp Keys', icon: Timer },
    { path: '/settings', label: 'Settings', icon: Settings },
    { path: '/logs', label: 'Logs', icon: ScrollText },
    { path: '/docs', label: 'Docs', icon: BookOpen },
  ];

  return (
    <div className="min-h-screen bg-transparent text-foreground relative flex flex-col">
      <header className="sticky top-0 z-50 glass border-b border-white/5">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-3"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold shadow-lg shadow-blue-500/20">
              M
            </div>
            <span className="font-bold text-lg tracking-tight text-gradient">MiMo Router</span>
          </motion.div>
          <nav className="flex items-center gap-2">
            {nav.map((item, index) => {
              const Icon = item.icon;
              const active = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    active ? 'text-blue-400' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                  }`}
                >
                  {active && (
                    <motion.div
                      layoutId="active-nav"
                      className="absolute inset-0 bg-blue-500/10 rounded-lg border border-blue-500/20"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                  <Icon className="w-4 h-4 relative z-10" />
                  <span className="relative z-10">{item.label}</span>
                </Link>
              );
            })}
            <Button variant="ghost" size="sm" onClick={() => logout.mutate()} className="ml-4 hover:bg-red-500/10 hover:text-red-500 transition-colors">
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </nav>
        </div>
      </header>
      
      <AnimatePresence mode="wait">
        <motion.main 
          key={location.pathname}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="container mx-auto px-4 py-8 flex-1"
        >
          {children}
        </motion.main>
      </AnimatePresence>
    </div>
  );
}
