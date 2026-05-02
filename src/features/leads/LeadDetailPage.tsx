import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { LeadForm } from './LeadForm';
import { useLead } from './hooks/useLead';
import { useConvertLead } from './hooks/useConvertLead';
import { useUpdateLead } from './hooks/useUpdateLead';
import { useAssignableOwners } from './hooks/useAssignableOwners';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { ActivityPanel } from '@/features/activity/ActivityPanel';

const UNASSIGNED = '__unassigned__';

export function LeadDetailPage() {
  const { leadId = '' } = useParams<{ leadId: string }>();
  const { t } = useTranslation('leads');
  const { data: lead, isLoading, error } = useLead(leadId);
  const convert = useConvertLead();
  const update = useUpdateLead();
  const { data: owners = [] } = useAssignableOwners();

  if (isLoading) return <div className="p-8">…</div>;
  if (error || !lead)
    return <div className="p-8 text-red-600">{error?.message ?? 'Not found'}</div>;

  const readOnly = !!lead.converted_at;

  async function onChangeOwner(newOwnerId: string) {
    if (!lead) return;
    const next = newOwnerId === UNASSIGNED ? null : newOwnerId;
    try {
      await update.mutateAsync({ id: lead.id, patch: { owner_user_id: next } });
    } catch (err) {
      alert((err as Error).message);
    }
  }

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{lead.title}</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="owner" className="text-sm">
              {t('owner.label')}:
            </Label>
            <select
              id="owner"
              value={lead.owner_user_id ?? UNASSIGNED}
              onChange={(e) => onChangeOwner(e.target.value)}
              disabled={readOnly || update.isPending}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              <option value={UNASSIGNED}>{t('owner.unassigned')}</option>
              {owners.map((o) => (
                <option key={o.user_id} value={o.user_id}>
                  {o.full_name || o.email}
                  {o.is_admin ? ' · admin' : ''}
                </option>
              ))}
            </select>
          </div>
          {!lead.converted_at && (
            <Button onClick={onConvert} disabled={convert.isPending}>
              {t('actions.convert')}
            </Button>
          )}
          {lead.converted_at && <span className="text-sm text-emerald-700">✓ converted</span>}
        </div>
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
