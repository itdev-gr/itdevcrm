import { useTranslation } from 'react-i18next';
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
    <header className="flex h-14 items-center gap-4 border-b px-4">
      <span className="font-semibold">{t('app_title')}</span>
      {session && <GlobalSearch />}
      <div className="ml-auto flex items-center gap-3">
        {session && <span className="text-sm text-muted-foreground">{userEmail}</span>}
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
