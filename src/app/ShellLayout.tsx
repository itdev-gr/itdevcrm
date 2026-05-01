import { Outlet } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';

export function ShellLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
