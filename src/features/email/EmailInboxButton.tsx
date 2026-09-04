import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEmailInboxBadge, useEmailInboxRealtime } from './hooks/useEmailInbox';

export function EmailInboxButton() {
  const { unreadCount } = useEmailInboxBadge();
  useEmailInboxRealtime();
  return (
    <Button asChild variant="ghost" size="icon" className="relative">
      <Link to="/inbox" aria-label="Inbox">
        <Mail className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1 text-[10px] text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Link>
    </Button>
  );
}
