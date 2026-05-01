import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function LocaleSwitcher() {
  const { i18n, t } = useTranslation();

  function changeLocale(value: string) {
    void i18n.changeLanguage(value);
  }

  return (
    <Select value={i18n.resolvedLanguage ?? 'en'} onValueChange={changeLocale}>
      <SelectTrigger className="w-32" aria-label={t('locale.label')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="en">{t('locale.en')}</SelectItem>
        <SelectItem value="el">{t('locale.el')}</SelectItem>
      </SelectContent>
    </Select>
  );
}
