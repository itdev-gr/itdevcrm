import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Shield, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader, SettingsCard } from '@/components/layout/page-shell';
import { useGroupsWithCounts } from './hooks/useGroupsWithCounts';

export function GroupsListPage() {
  const { t, i18n } = useTranslation('admin');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: groups = [], isLoading, error } = useGroupsWithCounts();

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-border/60 bg-card text-sm text-muted-foreground shadow-sm">
        …
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
        {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('groups.title')} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <SettingsCard key={g.id} className="flex flex-col justify-between p-5">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:text-[#7ad4d4]">
                <Shield className="size-5" />
              </span>
              <div className="min-w-0">
                <h2 className="font-semibold">{g.display_names[lang]}</h2>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Users className="size-3.5 opacity-70" />
                  {g.member_count} {t('groups.members')}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{g.parent_label}</p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="mt-4 w-full sm:w-auto">
              <Link to={`/admin/groups/${g.id}/permissions`}>{t('groups.manage')}</Link>
            </Button>
          </SettingsCard>
        ))}
      </div>
    </div>
  );
}
