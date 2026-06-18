import { useTranslation } from 'react-i18next';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useThemeStore } from '@/lib/stores/themeStore';
import { isThemeMode } from '@/lib/theme';

export function ThemeToggle() {
  const { t } = useTranslation();
  const mode = useThemeStore((state) => state.mode);
  const setMode = useThemeStore((state) => state.setMode);

  return (
    <Select
      value={mode}
      onValueChange={(value) => {
        if (isThemeMode(value)) setMode(value);
      }}
    >
      <SelectTrigger className="w-36" aria-label={t('theme.label')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="light">
          <span className="flex items-center gap-2">
            <Sun className="h-4 w-4" />
            {t('theme.light')}
          </span>
        </SelectItem>
        <SelectItem value="dark">
          <span className="flex items-center gap-2">
            <Moon className="h-4 w-4" />
            {t('theme.dark')}
          </span>
        </SelectItem>
        <SelectItem value="system">
          <span className="flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            {t('theme.system')}
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
