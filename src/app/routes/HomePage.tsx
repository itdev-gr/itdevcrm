import { useTranslation } from 'react-i18next';

export function HomePage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 p-8">
      <h1 className="text-2xl font-bold">{t('app_title')}</h1>
      <p>{t('tagline')}</p>
    </div>
  );
}
