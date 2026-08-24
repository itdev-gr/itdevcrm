import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { LogOut, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/stores/authStore';
import { signOut } from '@/lib/auth';
import { NotificationsBell } from '@/features/notifications/NotificationsBell';
import { GlobalSearch } from '@/features/search/GlobalSearch';
import { CallStatsWidget } from '@/features/callstats/CallStatsWidget';
import { BreakButton } from '@/features/break/BreakButton';

function userInitial(email: string) {
  return (email.trim()[0] ?? '?').toUpperCase();
}

export function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { t } = useTranslation();
  const session = useAuthStore((state) => state.session);
  const userEmail = useAuthStore((state) => state.user?.email ?? '');

  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/85 backdrop-blur-md">
      <div className="grid h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 lg:gap-6 lg:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          {session && onMenuClick && (
            <button
              type="button"
              onClick={onMenuClick}
              aria-label={t('nav.open_menu', { defaultValue: 'Open menu' })}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
            >
              <Menu className="size-5" />
            </button>
          )}
          <Link to="/" className="flex min-w-0 items-center gap-2.5">
            <img src="/favicon.png" alt="" className="size-8 shrink-0 rounded-lg" />
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-sm font-semibold leading-none">{t('app_title')}</p>
              <p className="truncate text-[11px] text-muted-foreground">{t('app_subtitle')}</p>
            </div>
          </Link>
        </div>

        <div className="flex min-w-0 justify-center px-1">{session && <GlobalSearch />}</div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {session && <CallStatsWidget />}
          {session && <BreakButton />}
          {session && (
            <>
              <Link
                to="/profile"
                className="hidden items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted lg:flex"
                title={userEmail}
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-[#1a9696]/15 text-xs font-semibold text-[#157777] dark:text-[#7ad4d4]">
                  {userInitial(userEmail)}
                </span>
                <span className="max-w-[160px] truncate text-sm text-muted-foreground">
                  {userEmail}
                </span>
              </Link>
              <NotificationsBell />
            </>
          )}
          {session && (
            <Button
              variant="ghost"
              size="sm"
              className="hidden text-muted-foreground sm:inline-flex"
              onClick={async () => {
                await signOut();
              }}
            >
              {t('nav.logout')}
            </Button>
          )}
          {session && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="sm:hidden"
              aria-label={t('nav.logout')}
              onClick={async () => {
                await signOut();
              }}
            >
              <LogOut className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
