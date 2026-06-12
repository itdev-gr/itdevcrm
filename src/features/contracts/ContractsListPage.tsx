import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/datetime';
import { useContracts } from './hooks/useContracts';
import { ContractStatusBadge } from './ContractStatusBadge';

function useClientOptions() {
  return useQuery({
    queryKey: ['contracts', 'client-options'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name')
        .eq('archived', false)
        .order('name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function ContractsListPage() {
  const { t } = useTranslation('contracts');
  const navigate = useNavigate();
  const { data: contracts = [], isLoading, error } = useContracts();
  const { data: clientOptions = [] } = useClientOptions();
  const [newClientId, setNewClientId] = useState('');

  return (
    <div className="flex min-h-full flex-col gap-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('list.title')}</h1>
        <div className="flex items-center gap-2">
          <select
            value={newClientId}
            onChange={(e) => setNewClientId(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            aria-label={t('list.pick_client')}
          >
            <option value="">{t('list.pick_client')}</option>
            {clientOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={!newClientId}
            onClick={() => navigate(`/contracts/new?clientId=${newClientId}`)}
          >
            + {t('actions.new')}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error.message}</p>
      ) : contracts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">{t('list.number')}</th>
                <th className="px-4 py-2">{t('list.client')}</th>
                <th className="px-4 py-2">{t('list.contract_title')}</th>
                <th className="px-4 py-2">{t('list.status')}</th>
                <th className="px-4 py-2">{t('list.created')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {contracts.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link to={`/contracts/${c.id}`} className="font-medium text-blue-600 underline">
                      {c.contract_number ?? c.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{c.clients?.name}</td>
                  <td className="px-4 py-2">{c.title}</td>
                  <td className="px-4 py-2"><ContractStatusBadge status={c.status} /></td>
                  <td className="px-4 py-2 text-slate-500">{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
