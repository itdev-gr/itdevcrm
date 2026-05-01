import { Outlet } from 'react-router-dom';
import { AdminGuard } from '@/components/auth/AdminGuard';

export function AdminLayout() {
  return (
    <AdminGuard>
      <Outlet />
    </AdminGuard>
  );
}
