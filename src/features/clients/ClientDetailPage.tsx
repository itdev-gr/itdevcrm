import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ClientForm } from './ClientForm';
import { useClient } from './hooks/useClient';
import { useDeals } from '@/features/deals/hooks/useDeals';
import { CreateDealDialog } from '@/features/deals/CreateDealDialog';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { ActivityPanel } from '@/features/activity/ActivityPanel';
import { useClientBlock } from '@/features/client_blocks/hooks/useClientBlock';
import { useUnblockClient } from '@/features/client_blocks/hooks/useUnblockClient';
import { BlockBadge } from '@/features/client_blocks/BlockBadge';
import { BlockClientDialog } from '@/features/client_blocks/BlockClientDialog';

export function ClientDetailPage() {
  const { clientId = '' } = useParams<{ clientId: string }>();
  const { t } = useTranslation('clients');
  const { data: client, isLoading, error } = useClient(clientId);
  const [dealOpen, setDealOpen] = useState(false);
  const { data: deals = [] } = useDeals({ clientId });
  const { t: tAcc } = useTranslation('accounting');
  const { data: block } = useClientBlock(clientId);
  const unblock = useUnblockClient();
  const [blockOpen, setBlockOpen] = useState(false);

  if (isLoading) return <div className="p-8">…</div>;
  if (error || !client)
    return <div className="p-8 text-red-600">{error?.message ?? 'Not found'}</div>;

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{client.name}</h1>
          <BlockBadge clientId={clientId} />
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
      <BlockClientDialog open={blockOpen} onOpenChange={setBlockOpen} clientId={clientId} />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="deals">{t('tabs.deals')}</TabsTrigger>
          <TabsTrigger value="jobs">{t('tabs.jobs')}</TabsTrigger>
          <TabsTrigger value="comments">{t('tabs.comments')}</TabsTrigger>
          <TabsTrigger value="attachments">{t('tabs.attachments')}</TabsTrigger>
          <TabsTrigger value="activity">{t('tabs.activity')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <ClientForm initial={client} />
        </TabsContent>
        <TabsContent value="deals" className="pt-4 space-y-3">
          <Button onClick={() => setDealOpen(true)}>{t('tabs.deals')}: New</Button>
          {deals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deals yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {deals.map((d) => (
                <li key={d.id} className="flex items-center justify-between px-4 py-2">
                  <span>{d.title}</span>
                  <Link to={`/deals/${d.id}`} className="text-blue-600 underline text-sm">
                    View
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <CreateDealDialog open={dealOpen} onOpenChange={setDealOpen} clientId={clientId} />
        </TabsContent>
        <TabsContent value="jobs" className="pt-4">
          <p className="text-sm text-muted-foreground">Jobs list (Phase 6)</p>
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
