import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, setCsrfToken } from '@/lib/api';

export function useAuth() {
  const queryClient = useQueryClient();

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['auth'],
    queryFn: api.me,
    retry: false,
    staleTime: 0,
  });

  const csrfToken = data?.csrfToken || '';

  if (csrfToken) {
    setCsrfToken(csrfToken);
  }

  const login = useMutation({
    mutationFn: api.login,
    onSuccess: (data) => {
      if ('csrfToken' in data && typeof data.csrfToken === 'string') {
        setCsrfToken(data.csrfToken);
      }
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  });

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth'] }),
  });

  return {
    isAuthenticated: data?.authenticated ?? false,
    isLoading: isPending,
    error,
    refetch,
    csrfToken,
    login,
    logout,
  };
}
