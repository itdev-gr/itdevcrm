import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useMyClients } from './hooks/useMyClients';
import { CreateClientDialog } from './CreateClientDialog';

export function ClientsListPage() {
  const { t } = useTranslation('clients');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data: clients = [], isLoading, error } = useMyClients();

  if (isLoading) return <div className="p-8">…</div>;
  if (error) return <div className="p-8 text-red-600">{error.message}</div>;

  return (
    <div className="space-y-4 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('my_clients')}</h1>
        <Button onClick={() => setOpen(true)}>{t('new_client')}</Button>
      </div>

      {clients.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4">{t('table.name')}</th>
              <th className="py-2 pr-4">{t('table.contact')}</th>
              <th className="py-2 pr-4">{t('table.email')}</th>
              <th className="py-2 pr-4">{t('table.phone')}</th>
              <th className="py-2 pr-4">{t('table.industry')}</th>
              <th className="py-2 pr-4">{t('table.country')}</th>
              <th className="py-2">{t('table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="py-2 pr-4 font-medium">{c.name}</td>
                <td className="py-2 pr-4">
                  {[c.contact_first_name, c.contact_last_name].filter(Boolean).join(' ')}
                </td>
                <td className="py-2 pr-4">{c.email}</td>
                <td className="py-2 pr-4">{c.phone}</td>
                <td className="py-2 pr-4">{c.industry}</td>
                <td className="py-2 pr-4">{c.country}</td>
                <td className="py-2">
                  <Link to={`/clients/${c.id}`} className="text-blue-600 underline">
                    {t('actions.view')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <CreateClientDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(id) => navigate(`/clients/${id}`)}
      />
    </div>
  );
}
