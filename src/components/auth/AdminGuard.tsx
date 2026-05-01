import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/lib/stores/authStore';

export function AdminGuard({ children }: { children: ReactNode }) {
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const isLoading = useAuthStore((state) => state.isLoading);
  if (isLoading) return <div className="p-8">…</div>;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
