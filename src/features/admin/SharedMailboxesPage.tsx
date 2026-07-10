import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { useGoogleConnection } from '@/features/email/useGoogleConnection';

type Row = {
  user_id: string;
  email: string;
  department: string;
  google_email: string | null;
  connected: boolean;
  last_synced_at: string | null;
  backfilled: boolean;
};

export function SharedMailboxesPage() {
  const { t } = useTranslation('admin');
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['shared-mailbox-status'],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc('shared_mailbox_status' as never);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Row[];
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{t('shared_mailboxes.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('shared_mailboxes.subtitle')}</p>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : (
        rows.map((row) => <MailboxCard key={row.user_id} row={row} t={t} />)
      )}
    </div>
  );
}

function MailboxCard({ row, t }: { row: Row; t: ReturnType<typeof useTranslation>['t'] }) {
  const conn = useGoogleConnection(row.user_id);
  const status = !row.connected
    ? t('shared_mailboxes.not_connected')
    : row.backfilled
      ? t('shared_mailboxes.syncing')
      : t('shared_mailboxes.backfilling');
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{row.email}</p>
        <p className="text-xs text-muted-foreground">
          <span className="mr-2 rounded-full bg-muted px-1.5 py-0.5 uppercase tracking-wide">
            {row.department}
          </span>
          {status}
          {row.last_synced_at && ` · ${new Date(row.last_synced_at).toLocaleString()}`}
        </p>
      </div>
      {row.connected ? (
        <Button variant="outline" size="sm" onClick={() => conn.disconnect()}>
          {t('shared_mailboxes.disconnect')}
        </Button>
      ) : (
        <Button size="sm" onClick={() => conn.connect()}>
          {t('shared_mailboxes.connect')}
        </Button>
      )}
    </section>
  );
}
