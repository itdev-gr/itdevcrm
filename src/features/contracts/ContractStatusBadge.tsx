import { useTranslation } from 'react-i18next';

const COLORS: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
  signed: 'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300',
  declined: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300',
};

export function ContractStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('contracts');
  return (
    <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-normal ${COLORS[status] ?? COLORS.draft}`}>
      {t(`status.${status}`)}
    </span>
  );
}
