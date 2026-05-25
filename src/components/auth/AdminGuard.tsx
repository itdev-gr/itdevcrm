import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/lib/stores/authStore';
import { useEffectiveIsAdmin } from '@/lib/viewAs';

export function AdminGuard({ children }: { children: ReactNode }) {
  const isAdmin = useEffectiveIsAdmin();
  const isLoading = useAuthStore((state) => state.isLoading);
  if (isLoading) return <div className="p-8">…</div>;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
