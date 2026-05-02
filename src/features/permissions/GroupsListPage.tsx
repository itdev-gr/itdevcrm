import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useGroupsWithCounts } from './hooks/useGroupsWithCounts';

export function GroupsListPage() {
  const { t, i18n } = useTranslation('admin');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: groups = [], isLoading, error } = useGroupsWithCounts();

  if (isLoading) return <div className="p-8">…</div>;
  if (error) return <div className="p-8 text-red-600">{error.message}</div>;

  return (
    <div className="space-y-4 p-8">
      <h1 className="text-2xl font-bold">{t('groups.title')}</h1>
      <ul className="divide-y rounded-md border">
        {groups.map((g) => (
          <li key={g.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="font-medium">{g.display_names[lang]}</div>
              <div className="text-sm text-muted-foreground">
                {g.member_count} {t('groups.members')} · {g.parent_label}
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to={`/admin/groups/${g.id}/permissions`}>{t('groups.manage')}</Link>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
