import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/datetime';
import { openPdfInNewTab } from '@/lib/openPdfInNewTab';
import { useContractsForClient } from './hooks/useContracts';
import { useDownloadContractPdf } from './hooks/useDownloadContractPdf';
import { ContractStatusBadge } from './ContractStatusBadge';

export function ContractsTab({ clientId }: { clientId: string }) {
  const { t } = useTranslation('contracts');
  const { data: contracts = [], isLoading, error } = useContractsForClient(clientId);
  const download = useDownloadContractPdf();

  return (
    <div className="space-y-3">
      <Button asChild size="sm">
        <Link to={`/contracts/new?clientId=${clientId}`}>+ {t('actions.new')}</Link>
      </Button>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>
      ) : contracts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {contracts.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <div>
                <div className="font-medium">
                  {c.contract_number ?? c.id.slice(0, 8)}
                  <ContractStatusBadge status={c.status} />
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {c.title} · {formatDate(c.created_at)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={download.isPending}
                  onClick={() => void openPdfInNewTab(() => download.mutateAsync(c.id))}
                >
                  {download.isPending ? '…' : 'PDF'}
                </Button>
                <Link to={`/contracts/${c.id}`} className="text-xs text-blue-600 underline dark:text-blue-400">
                  {t('actions.view')} →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
