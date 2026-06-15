import { useAuthStore } from '@/lib/stores/authStore';
import { useEmailHealth } from './useEmailHealth';
import { emailHealthMessage } from './emailHealth';

// Admin-only. Renders nothing when healthy or for non-admins.
export function EmailHealthBanner() {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { data } = useEmailHealth(isAdmin);
  if (!isAdmin) return null;
  const banner = emailHealthMessage(data);
  if (!banner) return null;
  const color = banner.severity === 'down' ? 'bg-red-600' : 'bg-amber-500';
  return (
    <div className={`${color} px-4 py-2 text-center text-sm font-medium text-white`} role="alert">
      ⚠ {banner.text}
    </div>
  );
}
