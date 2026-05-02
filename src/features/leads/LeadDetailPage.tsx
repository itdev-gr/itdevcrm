import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { LeadForm } from './LeadForm';
import { useLead } from './hooks/useLead';
import { useConvertLead } from './hooks/useConvertLead';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { ActivityPanel } from '@/features/activity/ActivityPanel';

export function LeadDetailPage() {
  const { leadId = '' } = useParams<{ leadId: string }>();
  const { t } = useTranslation('leads');
  const { data: lead, isLoading, error } = useLead(leadId);
  const convert = useConvertLead();

  if (isLoading) return <div className="p-8">…</div>;
  if (error || !lead)
    return <div className="p-8 text-red-600">{error?.message ?? 'Not found'}</div>;

  async function onConvert() {
    try {
      const result = await convert.mutateAsync(leadId);
      alert(`Converted. Client ${result.clientId} / Deal ${result.dealId}`);
    } catch (err) {
      const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
      alert(errors.map((er) => t(`convert.errors.${er}`, { defaultValue: er })).join('\n'));
    }
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{lead.title}</h1>
        {!lead.converted_at && (
          <Button onClick={onConvert} disabled={convert.isPending}>
            {t('actions.convert')}
          </Button>
        )}
        {lead.converted_at && <span className="text-sm text-emerald-700">✓ converted</span>}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="comments">{t('tabs.comments')}</TabsTrigger>
          <TabsTrigger value="attachments">{t('tabs.attachments')}</TabsTrigger>
          <TabsTrigger value="activity">{t('tabs.activity')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <LeadForm lead={lead} />
        </TabsContent>
        <TabsContent value="comments" className="pt-4">
          <CommentsPanel parentType="lead" parentId={leadId} />
        </TabsContent>
        <TabsContent value="attachments" className="pt-4">
          <AttachmentsPanel parentType="lead" parentId={leadId} />
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <ActivityPanel entityType="leads" entityId={leadId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
