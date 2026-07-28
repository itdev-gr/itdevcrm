import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const SERVICE_BADGE_CLASS: Record<string, string> = {
  web_seo: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200',
  local_seo: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200',
  web_dev: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200',
  social_media: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
  ai_seo: 'bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200',
  hosting: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
  ads: 'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200',
  maintenance: 'bg-teal-100 text-teal-800 dark:bg-teal-950/50 dark:text-teal-200',
  franchise: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  domains: 'bg-lime-100 text-lime-800 dark:bg-lime-950/50 dark:text-lime-200',
};

export function serviceTypeBadgeClass(serviceType: string): string {
  return (
    SERVICE_BADGE_CLASS[serviceType] ??
    'bg-primary/10 text-primary dark:text-[#7ad4d4]'
  );
}

export function ServiceTypeBadge({
  serviceType,
  label,
  className,
}: {
  serviceType: string;
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation('deals');
  const text = label ?? t(`services.types.${serviceType}`, { defaultValue: serviceType });

  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
        serviceTypeBadgeClass(serviceType),
        className,
      )}
    >
      {text}
    </span>
  );
}
