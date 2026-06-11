import { useTranslation } from 'react-i18next';

const COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  sent: 'bg-blue-100 text-blue-700',
  signed: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
};

export function ContractStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('contracts');
  return (
    <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-normal ${COLORS[status] ?? COLORS.draft}`}>
      {t(`status.${status}`)}
    </span>
  );
}
