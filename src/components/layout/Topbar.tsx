import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { LocaleSwitcher } from './LocaleSwitcher';
import { useAuthStore } from '@/lib/stores/authStore';
import { signOut } from '@/lib/auth';

export function Topbar() {
  const { t } = useTranslation();
  const session = useAuthStore((state) => state.session);
  const userEmail = useAuthStore((state) => state.user?.email ?? '');

  return (
    <header className="flex h-14 items-center justify-between border-b px-4">
      <span className="font-semibold">{t('app_title')}</span>
      <div className="flex items-center gap-3">
        {session && <span className="text-sm text-muted-foreground">{userEmail}</span>}
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
