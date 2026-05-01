import { useTranslation } from 'react-i18next';
import { LocaleSwitcher } from './LocaleSwitcher';

export function Topbar() {
  const { t } = useTranslation();
  return (
    <header className="flex h-14 items-center justify-between border-b px-4">
      <span className="font-semibold">{t('app_title')}</span>
      <div className="flex items-center gap-3">
        <LocaleSwitcher />
      </div>
    </header>
  );
}
