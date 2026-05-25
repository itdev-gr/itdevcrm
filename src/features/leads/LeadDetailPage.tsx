import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { LeadForm } from './LeadForm';
import { useLead } from './hooks/useLead';
import { useConvertLead } from './hooks/useConvertLead';
import { useUpdateLead } from './hooks/useUpdateLead';
import { useMoveLeadStage } from './hooks/useMoveLeadStage';
import { useAssignableOwners } from './hooks/useAssignableOwners';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { ActivityPanel } from '@/features/activity/ActivityPanel';
import { formatDate, relativeFromNow } from '@/lib/datetime';
import { useEffectiveIsAdmin, useEffectiveUserId } from '@/lib/viewAs';
import { CopyableCode } from '@/components/CopyableCode';
import { supabase } from '@/lib/supabase';
import { OffersTab } from '@/features/offers/OffersTab';

const UNASSIGNED = '__unassigned__';

export function LeadDetailPage() {
  const { leadId = '' } = useParams<{ leadId: string }>();
  const { t } = useTranslation('leads');
  const { data: lead, isLoading, error } = useLead(leadId);
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const navigate = useNavigate();
  const convert = useConvertLead();
  const update = useUpdateLead();
  const moveStage = useMoveLeadStage();
  const { data: owners = [] } = useAssignableOwners();
  const { data: stages = [] } = usePipelineStages();
  const isAdmin = useEffectiveIsAdmin();
  const userId = useEffectiveUserId();

  const newLeadStageId = stages.find(
    (s) => s.board === 'sales' && s.code === 'new_lead' && !s.archived,
  )?.id;

  const nextNewLead = useQuery({
    queryKey: ['next-new-lead', userId, newLeadStageId, leadId] as const,
    queryFn: async (): Promise<string | null> => {
      if (!newLeadStageId || !userId) return null;
      const { data, error: e } = await supabase
        .from('leads')
        .select('id, created_at')
        .eq('owner_user_id', userId)
        .eq('stage_id', newLeadStageId)
        .eq('archived', false)
        .is('converted_at', null)
        .order('created_at', { ascending: true });
      if (e) throw new Error(e.message);
      const list = data ?? [];
      if (list.length === 0) return null;
      // Pick the next chronologically-after-current lead, otherwise wrap
      // around to the first one that isn't this one. With this, "Next new
      // lead" always lands on a different lead when the user has more than
      // one assigned — instead of false-claiming "no more" when they're
      // viewing the most recent of their queue.
      const idx = list.findIndex((l) => l.id === leadId);
      if (idx === -1) return list[0]?.id ?? null;
      const after = list[idx + 1];
      if (after) return after.id;
      const wrapAround = list.find((l) => l.id !== leadId);
      return wrapAround?.id ?? null;
    },
    enabled: !!userId && !!newLeadStageId,
    staleTime: 30_000,
  });

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

  const salesStages = stages
    .filter((s) => s.board === 'sales' && !s.archived)
    .sort((a, b) => a.position - b.position);
  const wonStage = salesStages.find((s) => s.code === 'won');

  async function onChangeStage(targetStageId: string) {
    if (!lead || !targetStageId || targetStageId === lead.stage_id) return;
    if (wonStage && targetStageId === wonStage.id) {
      try {
        const result = await convert.mutateAsync(leadId);
        alert(`Converted. Client ${result.clientId} / Deal ${result.dealId}`);
      } catch (err) {
        const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
        alert(errors.map((er) => t(`convert.errors.${er}`, { defaultValue: er })).join('\n'));
      }
    } else {
      try {
        await moveStage.mutateAsync({ leadId, stageId: targetStageId });
      } catch (err) {
        alert((err as Error).message);
      }
    }
  }

  return (
    <div className="flex min-h-full flex-col gap-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-3">
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700">
              Lead
            </span>
            {lead.code && <CopyableCode code={lead.code} className="text-xs" />}
            <h1 className="text-2xl font-bold">{lead.title}</h1>
          </div>
          <p className="text-xs text-slate-500">
            🗓 {formatDate(lead.created_at)} · {relativeFromNow(lead.created_at)}
            {isAdmin && lead.won_by_user_id && (
              <span className="ml-2">
                · 🏆{' '}
                {(() => {
                  const winner = owners.find((o) => o.user_id === lead.won_by_user_id);
                  return winner ? winner.full_name || winner.email : lead.won_by_user_id;
                })()}
              </span>
            )}
          </p>
        </div>
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
            <div className="flex items-center gap-2">
              <Label htmlFor="stage" className="text-sm">
                {t('actions.move_to')}:
              </Label>
              <select
                id="stage"
                value={lead.stage_id ?? ''}
                onChange={(e) => onChangeStage(e.target.value)}
                disabled={convert.isPending || moveStage.isPending}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                {salesStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {(s.display_names as { en?: string; el?: string })[lang] ?? s.code}
                  </option>
                ))}
              </select>
            </div>
          )}
          {lead.converted_at && <span className="text-sm text-emerald-700">✓ converted</span>}
          <Button
            variant="outline"
            size="sm"
            onClick={() => nextNewLead.data && navigate(`/leads/${nextNewLead.data}`)}
            disabled={!nextNewLead.data || nextNewLead.isLoading}
          >
            {nextNewLead.isLoading
              ? '…'
              : nextNewLead.data
                ? t('actions.next_new_lead')
                : t('actions.no_more_new_leads')}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="attachments">{t('tabs.attachments')}</TabsTrigger>
          <TabsTrigger value="activity">{t('tabs.activity')}</TabsTrigger>
          <TabsTrigger value="offers">Offers</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[65%_35%]">
            <div className="min-w-0 lg:pr-6">
              <LeadForm lead={lead} />
            </div>
            <aside className="min-w-0 lg:border-l lg:pl-6">
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">
                {t('tabs.comments')}
              </h2>
              <CommentsPanel parentType="lead" parentId={leadId} />
            </aside>
          </div>
        </TabsContent>
        <TabsContent value="attachments" className="pt-4">
          <AttachmentsPanel parentType="lead" parentId={leadId} />
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <ActivityPanel entityType="leads" entityId={leadId} />
        </TabsContent>
        <TabsContent value="offers" className="pt-4">
          <OffersTab leadId={leadId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
