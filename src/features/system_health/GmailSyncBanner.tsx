import { Link } from 'react-router-dom';
import { useAuthStore } from '@/lib/stores/authStore';
import { useGmailSyncHealth } from './useGmailSyncHealth';
import { gmailSyncMessage } from './gmailSyncHealth';

// Admin-only. Renders nothing when healthy, for non-admins, or on RPC error.
export function GmailSyncBanner() {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { data } = useGmailSyncHealth(isAdmin);
  if (!isAdmin) return null;
  const banner = gmailSyncMessage(data);
  if (!banner) return null;
  const color = banner.severity === 'down' ? 'bg-red-600' : 'bg-amber-500';
  return (
    <Link
      to="/admin/email-health"
      className={`block ${color} px-4 py-2 text-center text-sm font-medium text-white transition hover:brightness-95`}
      role="alert"
    >
      ⚠ {banner.text} — view details
    </Link>
  );
}
