import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './hooks/useAuth';
import { Login } from './pages/Login';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Providers } from './pages/Providers';
import { ProviderDetails } from './pages/ProviderDetails';
import { ModelCatalog } from './pages/ModelCatalog';
import { ModelBenchmark } from './pages/ModelBenchmark';
import { Keys } from './pages/Keys';
import { Settings } from './pages/Settings';
import { Docs } from './pages/Docs';
import { Logs } from './pages/Logs';
import { Toaster } from './components/ui/toaster';
import { Button } from './components/ui/button';

function App() {
  const { isAuthenticated, isLoading, error, refetch } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAuthenticated) return;

    const sse = new EventSource('/admin/stream');

    sse.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'request_completed') {
          queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          queryClient.invalidateQueries({ queryKey: ['usage'] });
          queryClient.invalidateQueries({ queryKey: ['logs'] });
          queryClient.invalidateQueries({ queryKey: ['keys'] });
          queryClient.invalidateQueries({ queryKey: ['providers'] });
          queryClient.invalidateQueries({ queryKey: ['model-catalog'] });
        }
      } catch (err) {}
    };

    return () => sse.close();
  }, [isAuthenticated, queryClient]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">Connecting to server...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-4">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <span className="text-destructive text-2xl">!</span>
          </div>
          <h1 className="text-xl font-semibold">Unable to reach server</h1>
          <p className="text-muted-foreground text-sm">{error.message}</p>
          <div className="flex gap-2 justify-center">
            <Button onClick={() => refetch()}>Retry</Button>
            <Button variant="outline" onClick={() => window.location.reload()}>Reload</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <Login />
        <Toaster />
      </>
    );
  }

  return (
    <>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/providers" element={<Providers />} />
          <Route path="/providers/:id" element={<ProviderDetails />} />
          <Route path="/model-catalog" element={<ModelCatalog />} />
          <Route path="/model-benchmark" element={<ModelBenchmark />} />
          <Route path="/keys" element={<Keys />} />
          <Route path="/requests" element={<Logs />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      <Toaster />
    </>
  );
}

export default App;
