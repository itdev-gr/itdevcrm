import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/datetime';
import { useContractsForClient } from './hooks/useContracts';
import { ContractStatusBadge } from './ContractStatusBadge';

export function ContractsTab({ clientId }: { clientId: string }) {
  const { t } = useTranslation('contracts');
  const { data: contracts = [], isLoading } = useContractsForClient(clientId);

  return (
    <div className="space-y-3">
      <Button asChild size="sm">
        <Link to={`/contracts/new?clientId=${clientId}`}>+ {t('actions.new')}</Link>
      </Button>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : contracts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {contracts.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <div>
                <div className="font-medium">
                  {c.contract_number ?? c.id.slice(0, 8)}
                  <ContractStatusBadge status={c.status} />
                </div>
                <div className="text-[11px] text-slate-500">
                  {c.title} · {formatDate(c.created_at)}
                </div>
              </div>
              <Link to={`/contracts/${c.id}`} className="text-xs text-blue-600 underline">
                {t('actions.view')} →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
