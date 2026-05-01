import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useUsers } from './hooks/useUsers';
import { CreateUserDialog } from './CreateUserDialog';

export function UsersListPage() {
  const { t } = useTranslation('users');
  const { data: users = [], isLoading, error } = useUsers();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-4 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <Button onClick={() => setCreateOpen(true)}>{t('create')}</Button>
      </div>

      {isLoading && <p>…</p>}
      {error && (
        <p role="alert" className="text-red-600">
          {error.message}
        </p>
      )}

      {!isLoading && !error && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4">{t('table.name')}</th>
              <th className="py-2 pr-4">{t('table.email')}</th>
              <th className="py-2 pr-4">{t('table.groups')}</th>
              <th className="py-2 pr-4">{t('table.admin')}</th>
              <th className="py-2 pr-4">{t('table.active')}</th>
              <th className="py-2">{t('table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user_id} className="border-b">
                <td className="py-2 pr-4">{u.full_name}</td>
                <td className="py-2 pr-4">{u.email}</td>
                <td className="py-2 pr-4">
                  {(u.user_groups ?? [])
                    .map((row) => row.groups?.code)
                    .filter(Boolean)
                    .join(', ')}
                </td>
                <td className="py-2 pr-4">{u.is_admin ? '✓' : ''}</td>
                <td className="py-2 pr-4">{u.is_active ? '✓' : ''}</td>
                <td className="py-2">
                  <Link to={`/admin/users/${u.user_id}`} className="text-blue-600 underline">
                    {t('actions.view')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
