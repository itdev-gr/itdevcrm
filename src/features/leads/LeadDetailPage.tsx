import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Calendar, Trash2, Trophy } from 'lucide-react';
import { Tabs, TabsContent, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { FilterSelect, DetailTabsList, detailTabTriggerClass, detailOverviewWithCommentsGridClass, commentsPanelShellClass, commentsPanelHeaderClass, commentsPanelBodyClass, detailHeaderCardClass, detailHeaderControlGroupClass, detailHeaderActionsClass, detailHeaderLabelClass, detailHeaderMainClass, detailHeaderMetaClass, detailHeaderRecordBadgeClass, detailHeaderRowClass, detailHeaderSelectClass, detailHeaderTitleClass } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { LeadForm } from './LeadForm';
import { useLead } from './hooks/useLead';
import { useConvertLead } from './hooks/useConvertLead';
import { useUpdateLead } from './hooks/useUpdateLead';
import { useMoveLeadStage } from './hooks/useMoveLeadStage';
import { useAssignableOwners } from './hooks/useAssignableOwners';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { isStageMoveBlocked } from '@/features/sales/stageAccess';
import { useSalesBoardSortStore } from '@/features/sales/salesBoardSortStore';
import { useSalesBoardFilterStore } from '@/features/sales/salesBoardFilterStore';
import { orderForSort, pickNextId, searchOrClause } from '@/features/sales/salesKanbanColumns';
import { useDeleteLeads } from './hooks/useDeleteLeads';
import { isNotAccessible } from '@/lib/notAccessibleError';
import { isLeadDeletable } from './leadDeletable';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { CombinedAttachmentsTab } from '@/features/attachments/CombinedAttachmentsTab';
import { ActivityPanel } from '@/features/activity/ActivityPanel';
import { formatDate, relativeFromNow } from '@/lib/datetime';
import { formatPageTitle, useDocumentTitle } from '@/lib/documentTitle';
import { useAuthStore } from '@/lib/stores/authStore';
import { CopyableCode } from '@/components/CopyableCode';
import { supabase } from '@/lib/supabase';
import { LeadTasksTab } from './LeadTasksTab';
import { SendEmailDialog } from '@/features/email/SendEmailDialog';
import { EmailThreadList } from '@/features/email/EmailThreadList';
import { buildOfferDraft } from '@/features/email/buildDraft';

const UNASSIGNED = '__unassigned__';

function LeadDetailContent() {
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

  // "Next" walks the current lead's own kanban column, matching the board the
  // user just left: the same saved sort AND the same active owner/source/search
  // filter (mirrored via salesBoardFilterStore). RLS still scopes reps to their
  // own leads; admins iterate whatever the board's owner filter shows.
  const sortBy = useSalesBoardSortStore((s) => (userId ? s.byUser[userId] ?? 'newest' : 'newest'));
  const boardFilter = useSalesBoardFilterStore((s) => (userId ? s.byUser[userId] : undefined));

  // Fetch the whole ordered column, not just the first 1000 rows: PostgREST caps
  // each response at 1000, and busy stages (e.g. not_interested) exceed that, so
  // an un-paged fetch would strand the tail — and if the CURRENT lead sits in the
  // truncated part, pickNextId gets idx === -1 and jumps to the column's first
  // lead. Page in 1000-row chunks until a short page ends it. Query is a
  // byte-identical filter+order to useColumnLeads (minus the select shape) so
  // Next lands exactly where the board's next card is. Keyed on the filter so it
  // refetches when the board filter changes; the next id is derived via useMemo
  // so Next clicks / focus don't refetch the column.
  const nextInStageList = useQuery({
    queryKey: [
      'next-in-stage',
      lead?.stage_id,
      sortBy,
      boardFilter?.ownerId,
      boardFilter?.source,
      boardFilter?.search,
    ] as const,
    queryFn: async (): Promise<{ id: string }[]> => {
      if (!lead?.stage_id) return [];
      const order = orderForSort(sortBy);
      const orClause = searchOrClause(boardFilter?.search ?? '');
      const PAGE = 1000;
      const ids: { id: string }[] = [];
      for (let from = 0; ; from += PAGE) {
        let q = supabase
          .from('leads')
          .select('id')
          .eq('archived', false)
          .eq('stage_id', lead.stage_id)
          .order(order.column, { ascending: order.ascending })
          .order('id', { ascending: true }) // byte-identical to the column query
          .range(from, from + PAGE - 1);
        if (boardFilter?.ownerId) q = q.eq('owner_user_id', boardFilter.ownerId);
        if (boardFilter?.source) q = q.eq('source', boardFilter.source);
        if (orClause) q = q.or(orClause);
        const { data, error: e } = await q;
        if (e) throw new Error(e.message);
        const page = data ?? [];
        ids.push(...page);
        if (page.length < PAGE) break;
      }
      return ids;
    },
    enabled: !!lead?.stage_id,
    staleTime: 30_000,
  });
  const nextInStageId = useMemo(
    () => pickNextId(nextInStageList.data ?? [], leadId),
    [nextInStageList.data, leadId],
  );

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

  useDocumentTitle(
    formatPageTitle(
      lead?.contact_first_name || lead?.company_name,
      t('record_type.lead', { ns: 'common' }),
      lead?.code,
    ),
  );

  if (isLoading) return <div className="p-8">…</div>;
  if (error || !lead) {
    const denied = isNotAccessible(error);
    return denied ? (
      <div className="p-8 text-sm text-muted-foreground">You don't have access to this lead.</div>
    ) : (
      <div className="p-8 text-red-600">{error?.message ?? 'Not found'}</div>
    );
  }

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
  const currentStage = salesStages.find((s) => s.id === lead.stage_id);
  const currentStageCode = currentStage?.code;
  const stageName =
    (currentStage?.display_names as { en?: string; el?: string } | undefined)?.[lang] ??
    currentStage?.code ??
    '';
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
    <div className="flex min-h-full flex-col gap-1.5 px-4 py-2 sm:px-6 lg:px-8 lg:h-full lg:min-h-0 lg:overflow-hidden">
      <div className={detailHeaderCardClass}>
        <div className={detailHeaderRowClass}>
          <div className={detailHeaderMainClass}>
            <h1 className={detailHeaderTitleClass}>{lead.title}</h1>
            <span className={cn(detailHeaderRecordBadgeClass, 'bg-primary/10 text-primary')}>
              Lead
            </span>
            {lead.code && <CopyableCode code={lead.code} className="text-[11px]" />}
            <span
              className="hidden h-3.5 w-px shrink-0 bg-border/50 sm:inline-block"
              aria-hidden="true"
            />
            <span className={detailHeaderMetaClass}>
              <Calendar className="size-3 opacity-70" />
              {formatDate(lead.created_at)}
              <span className="opacity-60">·</span>
              {relativeFromNow(lead.created_at)}
              {isAdmin && lead.won_by_user_id && (
                <>
                  <span className="opacity-60">·</span>
                  <span className="inline-flex items-center gap-0.5">
                    <Trophy className="size-3 text-amber-600 dark:text-amber-400" />
                    {(() => {
                      const winner = owners.find((o) => o.user_id === lead.won_by_user_id);
                      return winner ? winner.full_name || winner.email : lead.won_by_user_id;
                    })()}
                  </span>
                </>
              )}
            </span>
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
          <div className={detailHeaderActionsClass}>
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
            {currentStage && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => nextInStageId && navigate(`/leads/${nextInStageId}`)}
                disabled={!nextInStageId || nextInStageList.isLoading}
              >
                {nextInStageList.isLoading
                  ? '…'
                  : nextInStageId
                    ? t('actions.next_in_stage', { stage: stageName })
                    : t('actions.no_more_in_stage', { stage: stageName })}
              </Button>
            )}
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
          <TabsTrigger value="emails" className={detailTabTriggerClass}>
            {t('tabs.emails')}
          </TabsTrigger>
          <TabsTrigger value="tasks" className={detailTabTriggerClass}>
            {t('tabs.tasks')}
          </TabsTrigger>
          <TabsTrigger value="activity" className={detailTabTriggerClass}>
            {t('tabs.activity')}
          </TabsTrigger>
        </DetailTabsList>

        <TabsContent value="overview" className="mt-1 outline-none lg:min-h-0 lg:flex-1 lg:overflow-hidden">
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
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('tabs.comments')}
                  </h2>
                </div>
                <div className={commentsPanelBodyClass}>
                  <CommentsPanel parentType="lead" parentId={leadId} />
                </div>
              </div>
            </aside>
          </div>
        </TabsContent>
        <TabsContent value="attachments" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <CombinedAttachmentsTab parentType="lead" parentId={leadId} leadId={leadId} />
        </TabsContent>
        <TabsContent value="emails" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <EmailThreadList
              scope={{ lead_id: leadId }}
              clientEmail={lead.email ?? ''}
              newEmailSubject={lead.code ? `${lead.code} - ` : ''}
            />
          </div>
        </TabsContent>
        <TabsContent value="tasks" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <LeadTasksTab leadId={leadId} leadTitle={lead.title} />
          </div>
        </TabsContent>
        <TabsContent value="activity" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <ActivityPanel entityType="leads" entityId={leadId} />
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

// Keyed on leadId so the whole page remounts when the record changes —
// seed-once state (form fields, dialogs) can't leak across leads on back-nav.
export function LeadDetailPage() {
  const { leadId = '' } = useParams<{ leadId: string }>();
  return <LeadDetailContent key={leadId} />;
}
