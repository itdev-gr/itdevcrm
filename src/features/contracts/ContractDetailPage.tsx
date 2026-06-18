import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate } from '@/lib/datetime';
import { useContract } from './hooks/useContracts';
import { useUpdateContract } from './hooks/useUpdateContract';
import { useDownloadContractPdf } from './hooks/useDownloadContractPdf';
import { useSendContract } from './hooks/useSendContract';
import { ContractStatusBadge } from './ContractStatusBadge';

const STATUSES = ['draft', 'sent', 'signed', 'declined'] as const;

export function ContractDetailPage() {
  const { contractId = '' } = useParams<{ contractId: string }>();
  const { t } = useTranslation('contracts');
  const { data: contract, isLoading, error } = useContract(contractId);
  const update = useUpdateContract();
  const download = useDownloadContractPdf();
  const send = useSendContract();
  const [title, setTitle] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);

  if (isLoading) return <div className="p-8">…</div>;
  if (error || !contract)
    return <div className="p-8 text-red-600 dark:text-red-400">{error?.message ?? 'Not found'}</div>;

  const curTitle = title ?? contract.title;
  const curBody = body ?? contract.body;
  const dirty = curTitle !== contract.title || curBody !== contract.body;
  const clientEmail = contract.clients?.email ?? null;

  // Throws on failure — callers wrap it so a failed save aborts download/send.
  async function saveEdits() {
    await update.mutateAsync({ id: contractId, patch: { title: curTitle, body: curBody } });
    setTitle(null);
    setBody(null);
  }

  async function onSave() {
    try {
      await saveEdits();
    } catch (err) {
      window.alert((err as Error).message ?? String(err));
    }
  }

  async function onDownload() {
    try {
      if (dirty) await saveEdits();
      const url = await download.mutateAsync(contractId);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      window.alert((err as Error).message ?? String(err));
    }
  }

  async function onSend() {
    if (!contract || !clientEmail) return;
    if (!window.confirm(t('detail.confirm_send', { email: clientEmail }))) return;
    try {
      if (dirty) await saveEdits();
      await send.mutateAsync({
        contractId,
        contractNumber: contract.contract_number ?? 'contract',
        title: curTitle,
        to: clientEmail,
        clientName: contract.clients?.name ?? '',
      });
      window.alert(t('detail.sent_ok'));
    } catch (err) {
      window.alert((err as Error).message ?? String(err));
    }
  }

  async function onChangeStatus(status: (typeof STATUSES)[number]) {
    try {
      await update.mutateAsync({ id: contractId, patch: { status } });
    } catch (err) {
      window.alert((err as Error).message ?? String(err));
    }
  }

  const busy = update.isPending || download.isPending || send.isPending;

  return (
    <div className="flex min-h-full flex-col gap-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-baseline">
            <h1 className="text-2xl font-bold">{contract.contract_number ?? contractId.slice(0, 8)}</h1>
            <ContractStatusBadge status={contract.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            <Link to={`/clients/${contract.client_id}`} className="underline">
              {contract.clients?.name}
            </Link>
            {' · '}
            {formatDate(contract.created_at)}
            {contract.sent_at && <> · ✉️ {formatDate(contract.sent_at)}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="ct-status" className="text-sm">{t('detail.status')}:</Label>
          <select
            id="ct-status"
            value={contract.status}
            onChange={(e) => onChangeStatus(e.target.value as (typeof STATUSES)[number])}
            disabled={busy}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{t(`status.${s}`)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="max-w-3xl space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ct-title">{t('builder.contract_title')}</Label>
          <Input id="ct-title" value={curTitle} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ct-body">{t('builder.body')}</Label>
          <textarea
            id="ct-body"
            value={curBody}
            onChange={(e) => setBody(e.target.value)}
            rows={20}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onSave} disabled={!dirty || busy}>{t('actions.save')}</Button>
          <Button variant="outline" onClick={onDownload} disabled={busy}>
            {t('actions.download_pdf')}
          </Button>
          <Button variant="outline" onClick={onSend} disabled={busy || !clientEmail}>
            ✉️ {t('actions.send')}
          </Button>
        </div>
        {!clientEmail && <p className="text-xs text-amber-600 dark:text-amber-400">{t('detail.no_email')}</p>}
      </div>
    </div>
  );
}
