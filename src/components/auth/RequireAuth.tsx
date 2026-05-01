import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/lib/stores/authStore';
import { useQuery } from '@tanstack/react-query';
import { fetchProfile } from '@/lib/profile';

export function RequireAuth({ children }: { children: ReactNode }) {
  const session = useAuthStore((state) => state.session);
  const isLoading = useAuthStore((state) => state.isLoading);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const location = useLocation();

  const profileQuery = useQuery({
    queryKey: ['profile', userId],
    queryFn: () => (userId ? fetchProfile(userId) : Promise.resolve(null)),
    enabled: !!userId,
    staleTime: 30_000,
  });

  if (isLoading || (!!userId && profileQuery.isLoading)) {
    return <div className="p-8">…</div>;
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (profileQuery.data?.must_change_password && location.pathname !== '/set-password') {
    return <Navigate to="/set-password" replace />;
  }
  return <>{children}</>;
}
