import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { AnnouncementPopup } from '@/features/announcements/AnnouncementPopup';

export function ShellLayout() {
  return (
    <RequireAuth>
      <AppShell>
        <Suspense fallback={<div className="p-8">…</div>}>
          <Outlet />
        </Suspense>
      </AppShell>
      <AnnouncementPopup />
    </RequireAuth>
  );
}
