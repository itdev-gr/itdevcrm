import { useTranslation } from 'react-i18next';

export function LoginBrandingPanel() {
  const { t } = useTranslation('auth');

  return (
    <div className="flex max-w-md flex-col items-center px-8 text-center">
      <img
        src="/logoitdev.png"
        alt="IT DEV"
        className="mx-auto h-32 w-auto max-w-full object-contain sm:h-40"
      />
      <p className="mt-4 text-sm font-semibold tracking-[0.35em] text-[#15243b]">
        {t('login.platform')}
      </p>
    </div>
  );
}
