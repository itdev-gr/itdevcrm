import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Eye, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  GroupPills,
  PageHeader,
  SettingsTableShell,
  StatusPill,
  UserAvatar,
  settingsTdClass,
  settingsThClass,
  settingsTheadClass,
  settingsTrClass,
} from '@/components/layout/page-shell';
import { useUsers } from './hooks/useUsers';
import { CreateUserDialog } from './CreateUserDialog';

export function UsersListPage() {
  const { t } = useTranslation('users');
  const { data: users = [], isLoading, error } = useUsers();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')}>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus className="size-4" />
          {t('create')}
        </Button>
      </PageHeader>

      {isLoading && (
        <div className="flex h-40 items-center justify-center rounded-xl border border-border/60 bg-card text-sm text-muted-foreground shadow-sm">
          …
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
        >
          {error.message}
        </div>
      )}

      {!isLoading && !error && (
        <SettingsTableShell>
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead className={settingsTheadClass}>
              <tr>
                <th className={settingsThClass}>{t('table.name')}</th>
                <th className={settingsThClass}>{t('table.groups')}</th>
                <th className={settingsThClass}>{t('table.admin')}</th>
                <th className={settingsThClass}>{t('table.active')}</th>
                <th className={`${settingsThClass} text-right`}>{t('table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const groupCodes = (u.user_groups ?? [])
                  .map((row) => row.groups?.code)
                  .filter((c): c is string => typeof c === 'string');
                return (
                  <tr key={u.user_id} className={settingsTrClass}>
                    <td className={settingsTdClass}>
                      <UserAvatar name={u.full_name} email={u.email} />
                    </td>
                    <td className={settingsTdClass}>
                      <GroupPills codes={groupCodes} />
                    </td>
                    <td className={settingsTdClass}>
                      <StatusPill
                        active={u.is_admin}
                        activeLabel={t('table.admin')}
                        inactiveLabel="—"
                      />
                    </td>
                    <td className={settingsTdClass}>
                      <StatusPill
                        active={u.is_active}
                        activeLabel={t('table.active')}
                        inactiveLabel={t('actions.deactivated')}
                      />
                    </td>
                    <td className={`${settingsTdClass} text-right`}>
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/admin/users/${u.user_id}`}>
                          <Eye className="size-3.5" />
                          {t('actions.view')}
                        </Link>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </SettingsTableShell>
      )}

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
