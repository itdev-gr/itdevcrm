import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFieldPermission } from './hooks/useFieldPermission';

export function PermissionsTestPage() {
  const { t } = useTranslation('admin');
  // Demo lookup: profiles.full_name
  const mode = useFieldPermission('profiles', 'full_name');

  return (
    <div className="space-y-4 p-8">
      <h1 className="text-2xl font-bold">{t('test_page.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('test_page.description')}</p>
      <p className="text-sm">{t('test_page.evaluation', { mode })}</p>

      {mode !== 'hidden' && (
        <div className="max-w-sm">
          <Label htmlFor="demo">{t('test_page.demo_field')}</Label>
          <Input id="demo" defaultValue="hello world" disabled={mode === 'readonly'} />
        </div>
      )}
    </div>
  );
}
