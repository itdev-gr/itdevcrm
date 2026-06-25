import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Calendar, Trash2, Trophy } from 'lucide-react';
import { Tabs, TabsContent, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { FilterSelect, DetailTabsList, detailTabTriggerClass, detailOverviewWithCommentsGridClass, commentsPanelShellClass, commentsPanelHeaderClass, commentsPanelBodyClass, detailHeaderCardClass, detailHeaderControlGroupClass, detailHeaderControlsClass, detailHeaderLabelClass, detailHeaderSelectClass } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { LeadForm } from './LeadForm';
import { useLead } from './hooks/useLead';
import { useConvertLead } from './hooks/useConvertLead';
import { useUpdateLead } from './hooks/useUpdateLead';
import { useMoveLeadStage } from './hooks/useMoveLeadStage';
import { useAssignableOwners } from './hooks/useAssignableOwners';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { isStageMoveBlocked } from '@/features/sales/stageAccess';
import { useDeleteLeads } from './hooks/useDeleteLeads';
import { isLeadDeletable } from './leadDeletable';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { ActivityPanel } from '@/features/activity/ActivityPanel';
import { formatDate, relativeFromNow } from '@/lib/datetime';
import { useAuthStore } from '@/lib/stores/authStore';
import { CopyableCode } from '@/components/CopyableCode';
import { supabase } from '@/lib/supabase';
import { OffersTab } from '@/features/offers/OffersTab';
import { SendEmailDialog } from '@/features/email/SendEmailDialog';
import { buildOfferDraft } from '@/features/email/buildDraft';

const UNASSIGNED = '__unassigned__';

export function LeadDetailPage() {
  const { leadId = '' } = useParams<{ leadId: string }>();
  const { t } = useTranslation('leads');
  const { t: tSales } = useTranslation('sales');
  const { data: lead, isLoading, error } = useLead(leadId);
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const navigate = useNavigate();
  const convert = useConvertLead();
  const update = useUpdateLead();
  const moveStage = useMoveLeadStage();
  const { data: owners = [] } = useAssignableOwners();
  const { data: stages = [] } = usePipelineStages();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const del = useDeleteLeads();
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const [offerEmailOpen, setOfferEmailOpen] = useState(false);
  const latestOffer = useQuery({
    queryKey: ['latest-offer', leadId] as const,
    queryFn: async (): Promise<string | null> => {
      const { data, error: e } = await supabase
        .from('offers')
        .select('id')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (e) throw new Error(e.message);
      return data?.[0]?.id ?? null;
    },
    enabled: !!leadId,
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
  const currentStageCode = salesStages.find((s) => s.id === lead.stage_id)?.code;
  const offerDraft = buildOfferDraft(
    lead.contact_first_name || lead.company_name || '',
    latestOffer.data ? `${window.location.origin}/offers/${latestOffer.data}` : window.location.origin,
  );

  async function onChangeStage(targetStageId: string) {
    if (!lead || !targetStageId || targetStageId === lead.stage_id) return;
    const targetStage = salesStages.find((s) => s.id === targetStageId);
    if (targetStage && isStageMoveBlocked(targetStage, userId)) {
      alert(tSales('kanban.locked_move'));
      return;
    }
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
    <div className="flex min-h-full flex-col gap-3 px-4 py-4 sm:px-6 lg:px-8 lg:h-full lg:min-h-0 lg:overflow-hidden">
      <div className={detailHeaderCardClass}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
                Lead
              </span>
              {lead.code && <CopyableCode code={lead.code} className="text-[11px]" />}
            </div>
            <h1 className="mt-1 text-lg font-bold tracking-tight sm:text-xl">{lead.title}</h1>
            <div className={cn(detailHeaderControlsClass, 'mt-1.5')}>
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="size-3 opacity-70" />
                  {formatDate(lead.created_at)}
                </span>
                <span>·</span>
                <span>{relativeFromNow(lead.created_at)}</span>
                {isAdmin && lead.won_by_user_id && (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Trophy className="size-3 text-amber-600 dark:text-amber-400" />
                      {(() => {
                        const winner = owners.find((o) => o.user_id === lead.won_by_user_id);
                        return winner ? winner.full_name || winner.email : lead.won_by_user_id;
                      })()}
                    </span>
                  </>
                )}
              </p>
              <div className={detailHeaderControlGroupClass}>
                <Label htmlFor="owner" className={detailHeaderLabelClass}>
                  {t('owner.label')}
                </Label>
                <FilterSelect
                  id="owner"
                  value={lead.owner_user_id ?? UNASSIGNED}
                  onChange={(e) => onChangeOwner(e.target.value)}
                  disabled={readOnly || update.isPending}
                  className={detailHeaderSelectClass}
                >
                  <option value={UNASSIGNED}>{t('owner.unassigned')}</option>
                  {owners.map((o) => (
                    <option key={o.user_id} value={o.user_id}>
                      {o.full_name || o.email}
                      {o.is_admin ? ' · admin' : ''}
                    </option>
                  ))}
                </FilterSelect>
              </div>
              {!lead.converted_at && (
                <div className={detailHeaderControlGroupClass}>
                  <Label htmlFor="stage" className={detailHeaderLabelClass}>
                    {t('actions.move_to')}
                  </Label>
                  <FilterSelect
                    id="stage"
                    value={lead.stage_id ?? ''}
                    onChange={(e) => onChangeStage(e.target.value)}
                    disabled={convert.isPending || moveStage.isPending}
                    className={detailHeaderSelectClass}
                  >
                    {salesStages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {(s.display_names as { en?: string; el?: string })[lang] ?? s.code}
                      </option>
                    ))}
                  </FilterSelect>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {currentStageCode === 'offer_sent' && (
              <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setOfferEmailOpen(true)}>
                {t('offer_email.send')}
              </Button>
            )}
            {lead.converted_at && (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                ✓ converted
              </span>
            )}
            {lead.email_opt_out ? (
              <span
                className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950/50 dark:text-red-300"
                title={t('automations.opted_out_hint')}
              >
                {t('automations.opted_out')}
              </span>
            ) : (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={lead.automations_enabled}
                  onChange={(e) =>
                    update.mutate({ id: lead.id, patch: { automations_enabled: e.target.checked } })
                  }
                  className="size-3.5 rounded border-input accent-primary"
                />
                {t('automations.label')}
              </label>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => nextNewLead.data && navigate(`/leads/${nextNewLead.data}`)}
              disabled={!nextNewLead.data || nextNewLead.isLoading}
            >
              {nextNewLead.isLoading
                ? '…'
                : nextNewLead.data
                  ? t('actions.next_new_lead')
                  : t('actions.no_more_new_leads')}
            </Button>
            {isAdmin &&
              isLeadDeletable({ converted_at: lead.converted_at, stage: { code: currentStageCode ?? null } }) && (
                <Button variant="destructive" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="size-3" />
                  {t('delete.button')}
                </Button>
              )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <DetailTabsList>
          <TabsTrigger value="overview" className={detailTabTriggerClass}>
            {t('tabs.overview')}
          </TabsTrigger>
          <TabsTrigger value="attachments" className={detailTabTriggerClass}>
            {t('tabs.attachments')}
          </TabsTrigger>
          <TabsTrigger value="activity" className={detailTabTriggerClass}>
            {t('tabs.activity')}
          </TabsTrigger>
          <TabsTrigger value="offers" className={detailTabTriggerClass}>
            {t('tabs.offers')}
          </TabsTrigger>
        </DetailTabsList>

        <TabsContent value="overview" className="mt-2 outline-none lg:min-h-0 lg:flex-1 lg:overflow-hidden">
          <div className={`${detailOverviewWithCommentsGridClass} lg:h-full lg:min-h-0`}>
            <div className="min-w-0 space-y-3 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pr-1">
              <LeadForm lead={lead} />
              {lead.intake_log ? (
                <section className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
                  <h2 className="mb-2 text-sm font-semibold tracking-tight text-foreground">
                    {t('intake_log.label')}
                  </h2>
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm text-muted-foreground">
                    {lead.intake_log}
                  </pre>
                </section>
              ) : null}
              <section className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
                <h2 className="mb-4 text-sm font-semibold tracking-tight text-foreground">
                  {t('tabs.attachments')}
                </h2>
                <AttachmentsPanel parentType="lead" parentId={leadId} />
              </section>
            </div>
            <aside className="min-w-0 lg:h-full lg:min-h-0">
              <div className={cn(commentsPanelShellClass, 'lg:h-full lg:min-h-0')}>
                <div className={commentsPanelHeaderClass}>
                  <h2 className="text-sm font-semibold">{t('tabs.comments')}</h2>
                </div>
                <div className={commentsPanelBodyClass}>
                  <CommentsPanel parentType="lead" parentId={leadId} />
                </div>
              </div>
            </aside>
          </div>
        </TabsContent>
        <TabsContent value="attachments" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <AttachmentsPanel parentType="lead" parentId={leadId} />
          </div>
        </TabsContent>
        <TabsContent value="activity" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <ActivityPanel entityType="leads" entityId={leadId} />
          </div>
        </TabsContent>
        <TabsContent value="offers" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <OffersTab leadId={leadId} />
          </div>
        </TabsContent>
      </Tabs>

      <SendEmailDialog
        open={offerEmailOpen}
        identity="personal"
        to={lead.email ?? ''}
        subject={offerDraft.subject}
        body={offerDraft.body}
        dedupeKey={`offer:${lead.id}`}
        onClose={() => setOfferEmailOpen(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('delete.title')}
        description={t('delete.confirm_one')}
        confirmLabel={t('delete.button')}
        pending={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync([lead.id]);
            setConfirmDelete(false);
            navigate('/sales/leads');
          } catch (e) {
            alert((e as Error).message);
          }
        }}
      />
    </div>
  );
}
