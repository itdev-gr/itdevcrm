import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { SetPasswordPage } from '@/features/auth/SetPasswordPage';

export function SetPasswordLayout() {
  return (
    <RequireAuth>
      <AppShell>
        <SetPasswordPage />
      </AppShell>
    </RequireAuth>
  );
}
