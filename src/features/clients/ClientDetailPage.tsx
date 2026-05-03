import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ClientForm } from './ClientForm';
import { useClient } from './hooks/useClient';
import { useDeals } from '@/features/deals/hooks/useDeals';
import { useJobsForClient } from '@/features/jobs/hooks/useJobsForClient';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { ActivityPanel } from '@/features/activity/ActivityPanel';
import { useClientBlock } from '@/features/client_blocks/hooks/useClientBlock';
import { useUnblockClient } from '@/features/client_blocks/hooks/useUnblockClient';
import { BlockBadge } from '@/features/client_blocks/BlockBadge';
import { BlockClientDialog } from '@/features/client_blocks/BlockClientDialog';
import { formatDate, relativeFromNow } from '@/lib/datetime';
import { supabase } from '@/lib/supabase';

export function ClientDetailPage() {
  const { clientId = '' } = useParams<{ clientId: string }>();
  const { t, i18n } = useTranslation('clients');
  const { t: tAcc } = useTranslation('accounting');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: client, isLoading, error } = useClient(clientId);
  const { data: deals = [] } = useDeals({ clientId });
  const { data: jobs = [] } = useJobsForClient(clientId);
  const { data: block } = useClientBlock(clientId);
  const unblock = useUnblockClient();
  const [blockOpen, setBlockOpen] = useState(false);

  if (isLoading) return <div className="p-8">…</div>;
  if (error || !client)
    return <div className="p-8 text-red-600">{error?.message ?? 'Not found'}</div>;

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
          <p className="text-xs text-slate-500">
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
          <TabsTrigger value="deals">
            {t('tabs.deals')} ({deals.length})
          </TabsTrigger>
          <TabsTrigger value="jobs">
            {t('tabs.jobs')} ({jobs.length})
          </TabsTrigger>
          <TabsTrigger value="comments">{t('tabs.comments')}</TabsTrigger>
          <TabsTrigger value="attachments">{t('tabs.attachments')}</TabsTrigger>
          <TabsTrigger value="activity">{t('tabs.activity')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <ClientForm initial={client} />
        </TabsContent>

        <TabsContent value="deals" className="space-y-3 pt-4">
          {deals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deals yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {deals.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium">{d.title}</div>
                    <div className="text-[11px] text-slate-500">
                      🗓 {formatDate(d.created_at)} · {relativeFromNow(d.created_at)}
                    </div>
                  </div>
                  <Link to={`/deals/${d.id}`} className="text-blue-600 underline text-xs">
                    View →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="jobs" className="space-y-3 pt-4">
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {jobs.map((j) => (
                <li
                  key={j.id}
                  className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium">
                      {j.service_type}
                      {j.stage && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-600">
                          {(j.stage.display_names as { en?: string; el?: string })[lang] ??
                            j.stage.code}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {j.billing_type}
                      {Number(j.monthly_amount ?? 0) > 0 &&
                        ` · €${Number(j.monthly_amount).toFixed(0)}/mo`}
                    </div>
                  </div>
                  <Link to={`/jobs/${j.id}`} className="text-blue-600 underline text-xs">
                    View →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="comments" className="pt-4">
          <CommentsPanel parentType="client" parentId={clientId} />
        </TabsContent>
        <TabsContent value="attachments" className="pt-4">
          <AttachmentsPanel parentType="client" parentId={clientId} />
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <ActivityPanel entityType="clients" entityId={clientId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
