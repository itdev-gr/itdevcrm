import { useTranslation } from 'react-i18next';
import { useClientBlock } from './hooks/useClientBlock';

export function BlockBadge({ clientId }: { clientId: string }) {
  const { t } = useTranslation('accounting');
  const { data: block } = useClientBlock(clientId);
  if (!block) return null;
  return (
    <span
      className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300"
      title={block.reason}
    >
      🚫 {t('block.badge')}
    </span>
  );
}
