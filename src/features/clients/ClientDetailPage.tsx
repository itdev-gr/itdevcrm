import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ClientForm } from './ClientForm';
import { useClient } from './hooks/useClient';
import { useDeals } from '@/features/deals/hooks/useDeals';
import { useJobsForClient } from '@/features/jobs/hooks/useJobsForClient';
import { JobsTab } from '@/features/jobs/JobsTab';
import { commentsPanelShellClass, commentsPanelHeaderClass, commentsPanelBodyClass } from '@/components/layout/page-shell';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { ContractsTab } from '@/features/contracts/ContractsTab';
import { ActivityPanel } from '@/features/activity/ActivityPanel';
import { ClientTasksTab } from './ClientTasksTab';
import { useClientBlock } from '@/features/client_blocks/hooks/useClientBlock';
import { useUnblockClient } from '@/features/client_blocks/hooks/useUnblockClient';
import { BlockBadge } from '@/features/client_blocks/BlockBadge';
import { BlockClientDialog } from '@/features/client_blocks/BlockClientDialog';
import { formatDate, relativeFromNow } from '@/lib/datetime';
import { formatPageTitle, useDocumentTitle } from '@/lib/documentTitle';
import { supabase } from '@/lib/supabase';

export function ClientDetailPage() {
  const { clientId = '' } = useParams<{ clientId: string }>();
  const { t } = useTranslation('clients');
  const { t: tAcc } = useTranslation('accounting');
  const { t: tContracts } = useTranslation('contracts');
  const { data: client, isLoading, error } = useClient(clientId);
  const { data: deals = [], isLoading: dealsLoading } = useDeals({ clientId });
  const { data: jobs = [] } = useJobsForClient(clientId);
  const { data: block } = useClientBlock(clientId);
  const unblock = useUnblockClient();
  const [blockOpen, setBlockOpen] = useState(false);

  useDocumentTitle(formatPageTitle(client?.name, t('record_type.client', { ns: 'common' })));

  if (isLoading || dealsLoading) return <div className="p-8">…</div>;
  if (error || !client)
    return <div className="p-8 text-red-600 dark:text-red-400">{error?.message ?? 'Not found'}</div>;

  // 1 client = 1 live deal in this CRM. Whenever one exists, the deal is the
  // canonical working record — redirect there so users always land on the
  // page with the full payments / services / accounting context.
  const liveDeal = deals.find((d) => !d.archived);
  if (liveDeal) {
    return <Navigate to={`/deals/${liveDeal.id}`} replace />;
  }

  async function onChangeStatus(nextStatus: string) {
    if (!client) return;
    const { error: e } = await supabase
      .from('clients')
      .update({ status: nextStatus })
      .eq('id', client.id);
    if (e) alert(e.message);
  }

  return (
    <div className="flex min-h-full flex-col gap-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-bold">{client.name}</h1>
            <BlockBadge clientId={clientId} />
          </div>
          <p className="text-xs text-muted-foreground">
            🗓 {formatDate(client.created_at)} · {relativeFromNow(client.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="client-status" className="text-sm">
              {t('status.label')}:
            </Label>
            <select
              id="client-status"
              value={client.status ?? 'new'}
              onChange={(e) => onChangeStatus(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              <option value="new">{t('status.new')}</option>
              <option value="active">{t('status.active')}</option>
              <option value="blocked">{t('status.blocked')}</option>
              <option value="done">{t('status.done')}</option>
            </select>
          </div>
          {block ? (
            <Button
              variant="outline"
              onClick={() => unblock.mutate(clientId)}
              disabled={unblock.isPending}
            >
              {tAcc('block.button_unblock')}
            </Button>
          ) : (
            <Button variant="destructive" onClick={() => setBlockOpen(true)}>
              {tAcc('block.button')}
            </Button>
          )}
        </div>
      </div>
      <BlockClientDialog open={blockOpen} onOpenChange={setBlockOpen} clientId={clientId} />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="jobs">
            {t('tabs.jobs')} ({jobs.length})
          </TabsTrigger>
          <TabsTrigger value="comments">{t('tabs.comments')}</TabsTrigger>
          <TabsTrigger value="attachments">{t('tabs.attachments')}</TabsTrigger>
          <TabsTrigger value="tasks">{t('tabs.tasks')}</TabsTrigger>
          <TabsTrigger value="contracts">{tContracts('tab.title')}</TabsTrigger>
          <TabsTrigger value="activity">{t('tabs.activity')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <ClientForm initial={client} />
        </TabsContent>

        <TabsContent value="jobs" className="space-y-3 pt-4">
          <JobsTab clientId={clientId} />
        </TabsContent>

        <TabsContent value="comments" className="pt-4">
          <div className={`${commentsPanelShellClass} max-w-5xl`}>
            <div className={commentsPanelHeaderClass}>
              <h2 className="text-sm font-semibold">{t('tabs.comments')}</h2>
            </div>
            <div className={commentsPanelBodyClass}>
              <CommentsPanel parentType="client" parentId={clientId} />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="attachments" className="pt-4">
          <AttachmentsPanel parentType="client" parentId={clientId} />
        </TabsContent>
        <TabsContent value="tasks" className="pt-4">
          <ClientTasksTab clientId={clientId} clientName={client?.name ?? ''} />
        </TabsContent>
        <TabsContent value="contracts" className="pt-4">
          <ContractsTab clientId={clientId} />
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <ActivityPanel entityType="clients" entityId={clientId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
