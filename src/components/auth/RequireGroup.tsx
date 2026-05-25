import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/lib/stores/authStore';
import { useEffectiveGroupCodes, useEffectiveIsAdmin } from '@/lib/viewAs';

type Props = {
  groups: string[];
  children: ReactNode;
};

export function RequireGroup({ groups, children }: Props) {
  const isAdmin = useEffectiveIsAdmin();
  const isLoading = useAuthStore((s) => s.isLoading);
  const groupCodes = useEffectiveGroupCodes();

  if (isLoading) return <div className="p-8">…</div>;
  if (isAdmin) return <>{children}</>;
  if (groupCodes.some((c) => groups.includes(c))) return <>{children}</>;
  return <Navigate to="/" replace />;
}
