import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/**
 * Universal back button, rendered once in AppShell above page content so it
 * appears on every authenticated page.
 *
 * react-router stamps a numeric `idx` onto `window.history.state` as you
 * navigate within the app. When `idx > 0` there is an in-app entry to return
 * to, so we pop history (landing exactly where the user came from). On a fresh
 * load (direct link, refresh, email/Zapier link, new tab) `idx` is 0/absent, so
 * we fall back to Home instead of dead-ending.
 *
 * Hidden on the Home route itself, where "back to home" would be a no-op.
 */
export function BackButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  if (pathname === '/') return null;

  function handleClick() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/');
  }

  return (
    <div className="px-6 pt-4 sm:px-8">
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('back')}
      </button>
    </div>
  );
}
