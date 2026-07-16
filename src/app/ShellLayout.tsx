import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { AnnouncementPopup } from '@/features/announcements/AnnouncementPopup';
import { ToastContainer } from '@/features/notifications/ToastContainer';

export function ShellLayout() {
  return (
    <RequireAuth>
      <AppShell>
        <Suspense fallback={<div className="p-8">…</div>}>
          <Outlet />
        </Suspense>
      </AppShell>
      <AnnouncementPopup />
      <ToastContainer />
    </RequireAuth>
  );
}
