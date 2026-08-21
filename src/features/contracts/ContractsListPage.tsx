import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/datetime';
import { useContracts } from './hooks/useContracts';
import { ContractStatusBadge } from './ContractStatusBadge';
import { ContractPartyPicker, type ContractParty } from './ContractPartyPicker';

export function ContractsListPage() {
  const { t } = useTranslation('contracts');
  const navigate = useNavigate();
  const { data: contracts = [], isLoading, error } = useContracts();
  const [party, setParty] = useState<ContractParty | null>(null);

  return (
    <div className="flex min-h-full flex-col gap-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('list.title')}</h1>
        <div className="flex items-center gap-2">
          <ContractPartyPicker id="ct-party" value={party} onChange={setParty} />
          <Button
            size="sm"
            disabled={!party}
            onClick={() => {
              if (!party) return;
              navigate(
                party.type === 'client'
                  ? `/contracts/new?clientId=${party.id}`
                  : `/contracts/new?leadId=${party.id}`,
              );
            }}
          >
            + {t('actions.new')}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>
      ) : contracts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">{t('list.number')}</th>
                <th className="px-4 py-2">{t('list.party')}</th>
                <th className="px-4 py-2">{t('list.contract_title')}</th>
                <th className="px-4 py-2">{t('list.status')}</th>
                <th className="px-4 py-2">{t('list.created')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {contracts.map((c) => (
                <tr key={c.id} className="hover:bg-muted">
                  <td className="px-4 py-2">
                    <Link to={`/contracts/${c.id}`} className="font-medium text-blue-600 underline dark:text-blue-400">
                      {c.contract_number ?? c.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    {c.clients?.name ?? c.leads?.company_name ?? c.leads?.title}
                    {c.lead_id && (
                      <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                        Lead
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">{c.title}</td>
                  <td className="px-4 py-2"><ContractStatusBadge status={c.status} /></td>
                  <td className="px-4 py-2 text-muted-foreground">{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
