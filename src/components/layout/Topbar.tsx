import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { LocaleSwitcher } from './LocaleSwitcher';
import { useAuthStore } from '@/lib/stores/authStore';
import { signOut } from '@/lib/auth';
import { NotificationsBell } from '@/features/notifications/NotificationsBell';
import { GlobalSearch } from '@/features/search/GlobalSearch';

export function Topbar() {
  const { t } = useTranslation();
  const session = useAuthStore((state) => state.session);
  const userEmail = useAuthStore((state) => state.user?.email ?? '');

  return (
    <header className="grid h-14 grid-cols-[auto_1fr_auto] items-center gap-4 border-b px-4">
      <span className="font-semibold">{t('app_title')}</span>
      <div className="flex justify-center">{session && <GlobalSearch />}</div>
      <div className="flex items-center gap-3">
        {session && (
          <Link
            to="/profile"
            className="text-sm text-muted-foreground hover:text-slate-900 hover:underline"
            title={userEmail}
          >
            {userEmail}
          </Link>
        )}
        {session && <NotificationsBell />}
        <LocaleSwitcher />
        {session && (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await signOut();
            }}
          >
            {t('nav.logout')}
          </Button>
        )}
      </div>
    </header>
  );
}
