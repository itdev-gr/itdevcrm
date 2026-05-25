import { useAuthStore } from '@/lib/stores/authStore';

export const TEST_VIEW_AS_EMAIL = 'test@itdev.gr';

export function isTestViewAsEmail(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === TEST_VIEW_AS_EMAIL;
}

export function useCanViewAsAccounts(): boolean {
  return useAuthStore((s) => s.isAdmin && isTestViewAsEmail(s.user?.email));
}

export function useEffectiveUserId(): string | null {
  return useAuthStore((s) => s.viewAsUser?.userId ?? s.user?.id ?? null);
}

export function useEffectiveIsAdmin(): boolean {
  return useAuthStore((s) => s.viewAsUser?.isAdmin ?? s.isAdmin);
}

export function useEffectiveGroupCodes(): string[] {
  return useAuthStore((s) => s.viewAsUser?.groupCodes ?? s.groupCodes);
}
