import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { DealForm } from './DealForm';
import { useDeal } from './hooks/useDeal';
import { useLockDeal } from './hooks/useLockDeal';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';

export function DealDetailPage() {
  const { dealId = '' } = useParams<{ dealId: string }>();
  const { t } = useTranslation('deals');
  const { data: deal, isLoading, error } = useDeal(dealId);
  const lock = useLockDeal();

  if (isLoading) return <div className="p-8">…</div>;
  if (error || !deal)
    return <div className="p-8 text-red-600">{error?.message ?? 'Not found'}</div>;

  async function onLock() {
    try {
      await lock.mutateAsync(dealId);
    } catch (err) {
      const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
      alert(errors.map((e) => t(`lock.errors.${e}`, { defaultValue: e })).join('\n'));
    }
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{deal.title}</h1>
        {!deal.locked_at && (
          <Button onClick={onLock} disabled={lock.isPending}>
            {t('actions.lock')}
          </Button>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="jobs">{t('tabs.jobs')}</TabsTrigger>
          <TabsTrigger value="comments">{t('tabs.comments')}</TabsTrigger>
          <TabsTrigger value="attachments">{t('tabs.attachments')}</TabsTrigger>
          <TabsTrigger value="activity">{t('tabs.activity')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <DealForm initial={deal} />
        </TabsContent>
        <TabsContent value="jobs" className="pt-4">
          <p className="text-sm text-muted-foreground">Jobs (Phase 6)</p>
        </TabsContent>
        <TabsContent value="comments" className="pt-4">
          <CommentsPanel parentType="deal" parentId={dealId} />
        </TabsContent>
        <TabsContent value="attachments" className="pt-4">
          <AttachmentsPanel parentType="deal" parentId={dealId} />
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <p className="text-sm text-muted-foreground">Activity (Task 20)</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
