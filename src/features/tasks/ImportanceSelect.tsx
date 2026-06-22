import { useTranslation } from 'react-i18next';
import { IMPORTANCE_OPTIONS, type ImportanceCode } from './importance';

export function ImportanceSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: ImportanceCode | '';
  onChange: (v: ImportanceCode) => void;
}) {
  const { t } = useTranslation('common');
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as ImportanceCode)}
      required
      className="block h-9 w-full rounded-lg border border-input/80 bg-background px-3 text-sm shadow-sm transition-colors focus:border-[#1a9696]/40 focus:outline-none focus:ring-2 focus:ring-[#1a9696]/20"
    >
      <option value="" disabled>
        {t('importance.placeholder')}
      </option>
      {IMPORTANCE_OPTIONS.map((code) => (
        <option key={code} value={code}>
          {t(`importance.${code}`)}
        </option>
      ))}
    </select>
  );
}
