import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Calendar, Lock, Mail } from 'lucide-react';
import { Tabs, TabsContent, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DetailTabsList, FilterSelect, detailTabTriggerClass, detailOverviewWithCommentsGridClass, commentsPanelShellClass, commentsPanelHeaderClass, commentsPanelBodyClass, detailHeaderCardClass, detailHeaderControlGroupClass, detailHeaderActionsClass, detailHeaderLabelClass, detailHeaderMainClass, detailHeaderMetaClass, detailHeaderRecordBadgeClass, detailHeaderRowClass, detailHeaderSelectClass, detailHeaderStatusBadgeClass, detailHeaderTitleClass } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { DealForm } from './DealForm';
import { useDeal } from './hooks/useDeal';
import { useMoveAccountingStage } from '@/features/accounting/hooks/useMoveAccountingStage';
import { useMarkPaidInFull } from '@/features/accounting/hooks/useMarkPaidInFull';
import { CloseDealDialog } from '@/features/accounting/CloseDealDialog';
import { classifyAccountingStageMove } from './accountingStageMove';
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { PaymentsPanel } from './PaymentsPanel';
import { JobsBillingPanel } from './JobsBillingPanel';
import type { PlannedService } from './ServicesPlannedField';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { ActivityPanel } from '@/features/activity/ActivityPanel';
import { formatDate, relativeFromNow } from '@/lib/datetime';
import { formatPageTitle, useDocumentTitle } from '@/lib/documentTitle';
import { useAuthStore } from '@/lib/stores/authStore';
import { CopyableCode } from '@/components/CopyableCode';
import { supabase } from '@/lib/supabase';
import { OffersTab } from '@/features/offers/OffersTab';
import { ContractsTab } from '@/features/contracts/ContractsTab';
import { JobsTab } from '@/features/jobs/JobsTab';
import { AssignedTasksTab } from '@/features/assigned_tasks/AssignedTasksTab';
import { SendEmailDialog } from '@/features/email/SendEmailDialog';
import { buildWonDraft } from '@/features/email/buildDraft';
import { DealServiceInfo } from './DealServiceInfo';
import { DealServiceAttachments } from './DealServiceAttachments';
import { DealNotesArea } from './DealNotesArea';

const UNASSIGNED = '__unassigned__';

const CLIENT_STATUS_STYLES: Record<string, string> = {
  new: 'border-border/70 bg-muted/40 dark:border-border/60 dark:bg-muted/70',
  active:
    'border-emerald-500/30 bg-emerald-500/5 dark:border-emerald-500/40 dark:bg-emerald-950/50 dark:text-emerald-100',
  blocked: 'border-red-500/30 bg-red-500/5 dark:border-red-500/40 dark:bg-red-950/50 dark:text-red-100',
  done: 'border-border/70 bg-muted/40 dark:border-border/60 dark:bg-muted/70',
};

export function DealDetailPage() {
  const { dealId = '' } = useParams<{ dealId: string }>();
  const { t, i18n } = useTranslation('deals');
  const { t: tLeads } = useTranslation('leads');
  const { t: tAccounting } = useTranslation('accounting');
  const { t: tClients } = useTranslation('clients');
  const { t: tContracts } = useTranslation('contracts');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: deal, isLoading, error } = useDeal(dealId);
  const moveAccounting = useMoveAccountingStage();
  const markPaid = useMarkPaidInFull();
  const { data: owners = [] } = useAssignableOwners();
  const { data: stages = [] } = usePipelineStages();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const canManageBilling = isAdmin || groupCodes.includes('accounting');
  const wonBy = deal?.won_by_user_id
    ? owners.find((o) => o.user_id === deal.won_by_user_id)
    : null;
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  useDocumentTitle(
    formatPageTitle(
      deal?.client?.name || deal?.title,
      t('record_type.deal', { ns: 'common' }),
      deal?.code,
    ),
  );

  if (isLoading) return <div className="px-4 py-6 sm:px-6 lg:px-8">…</div>;
  if (error || !deal) {
    return (
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {error?.message ?? 'Not found'}
        </div>
      </div>
    );
  }

  const wonWelcomeDraft = buildWonDraft(deal.client?.name ?? '');
  const completed = !!deal.accounting_completed_at;
  const dealServices: PlannedService[] = Array.isArray(deal.services_planned)
    ? (deal.services_planned as unknown as PlannedService[])
    : [];
  const clientStatus = deal.client?.status ?? 'new';

  const accStages = stages
    .filter((s) => s.board === 'accounting_onboarding' && !s.archived)
    .sort((a, b) => a.position - b.position);
  const paidStage = accStages.find((s) => s.code === 'paid_in_full');
  const closedStage = accStages.find((s) => s.code === 'closed');

  async function onChangeOwner(newOwnerId: string) {
    if (!deal) return;
    const next = newOwnerId === UNASSIGNED ? null : newOwnerId;
    const { error: e } = await supabase
      .from('deals')
      .update({ owner_user_id: next })
      .eq('id', deal.id);
    if (e) alert(e.message);
  }

  async function onChangeClientStatus(nextStatus: string) {
    if (!deal?.client_id) return;
    const { error: e } = await supabase
      .from('clients')
      .update({ status: nextStatus })
      .eq('id', deal.client_id);
    if (e) alert(e.message);
  }

  async function onChangeAccountingStage(targetStageId: string) {
    if (!deal) return;
    const action = classifyAccountingStageMove({
      targetStageId,
      currentStageId: deal.accounting_stage_id ?? null,
      paidStageId: paidStage?.id,
      closedStageId: closedStage?.id,
    });
    if (action === 'noop') return;
    // Moving to Closed → same confirmation dialog as the Accounting board
    // (marks the jobs done + moves them to their close lanes, then closes the deal).
    if (action === 'close') {
      setCloseOpen(true);
      return;
    }
    if (!deal.payment_method) {
      alert(tAccounting('kanban.move_errors.payment_method_required'));
      return;
    }
    if (action === 'paid') {
      try {
        await markPaid.mutateAsync(dealId);
      } catch (err) {
        const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
        alert(
          errors.map((er) => tAccounting(`complete.errors.${er}`, { defaultValue: er })).join('\n'),
        );
      }
    } else {
      try {
        await moveAccounting.mutateAsync({ dealId, stageId: targetStageId });
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
            <h1 className={detailHeaderTitleClass}>{deal.title}</h1>
            <span
              className={cn(
                detailHeaderRecordBadgeClass,
                'bg-violet-500/10 text-violet-700 dark:text-violet-300',
              )}
            >
              Deal
            </span>
            {deal.code && <CopyableCode code={deal.code} className="text-[11px]" />}
            {clientStatus === 'blocked' && (
              <span
                className={cn(
                  detailHeaderStatusBadgeClass,
                  'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
                )}
              >
                <Lock className="size-2.5" />
                {tClients('status.blocked')}
              </span>
            )}
            <span
              className="hidden h-3.5 w-px shrink-0 bg-border/50 sm:inline-block"
              aria-hidden="true"
            />
            <span className={detailHeaderMetaClass}>
              <Calendar className="size-3 opacity-70" />
              {formatDate(deal.created_at)}
              <span className="opacity-60">·</span>
              {relativeFromNow(deal.created_at)}
              {wonBy && (
                <>
                  <span className="opacity-60">·</span>
                  <span>{wonBy.full_name || wonBy.email}</span>
                </>
              )}
            </span>
            <div className={detailHeaderControlGroupClass}>
              <Label htmlFor="client-status" className={detailHeaderLabelClass}>
                {tClients('status.label')}
              </Label>
              <FilterSelect
                id="client-status"
                value={clientStatus}
                onChange={(e) => onChangeClientStatus(e.target.value)}
                className={cn(detailHeaderSelectClass, CLIENT_STATUS_STYLES[clientStatus])}
              >
                <option value="new">{tClients('status.new')}</option>
                <option value="active">{tClients('status.active')}</option>
                <option value="blocked">{tClients('status.blocked')}</option>
                <option value="done">{tClients('status.done')}</option>
              </FilterSelect>
            </div>
            <div className={detailHeaderControlGroupClass}>
              <Label htmlFor="owner" className={detailHeaderLabelClass}>
                {tLeads('owner.label')}
              </Label>
              <FilterSelect
                id="owner"
                value={deal.owner_user_id ?? UNASSIGNED}
                onChange={(e) => onChangeOwner(e.target.value)}
                disabled={completed}
                className={detailHeaderSelectClass}
              >
                <option value={UNASSIGNED}>{tLeads('owner.unassigned')}</option>
                {owners.map((o) => (
                  <option key={o.user_id} value={o.user_id}>
                    {o.full_name || o.email}
                    {o.is_admin ? ' · admin' : ''}
                  </option>
                ))}
              </FilterSelect>
            </div>
            {deal.accounting_stage_id && accStages.length > 0 && (
              <div className={detailHeaderControlGroupClass}>
                <Label htmlFor="acc-stage" className={detailHeaderLabelClass}>
                  {tLeads('actions.move_to')}
                </Label>
                <FilterSelect
                  id="acc-stage"
                  value={deal.accounting_stage_id ?? ''}
                  onChange={(e) => onChangeAccountingStage(e.target.value)}
                  disabled={moveAccounting.isPending || markPaid.isPending}
                  className={detailHeaderSelectClass}
                >
                  {accStages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {(s.display_names as { en?: string; el?: string })[lang] ?? s.code}
                    </option>
                  ))}
                </FilterSelect>
              </div>
            )}
          </div>
          <div className={detailHeaderActionsClass}>
            {deal.won_by_user_id && (
              <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setWelcomeOpen(true)}>
                <Mail className="size-3" />
                {t('welcome_email.send')}
              </Button>
            )}
            {completed && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                ✓ {tAccounting('actions.complete')}
              </span>
            )}
            {isAdmin && deal.locked_at && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300"
                title={formatDate(deal.locked_at)}
              >
                <Lock className="size-2.5" />
                {relativeFromNow(deal.locked_at)}
              </span>
            )}
          </div>
        </div>
      </div>

      <SendEmailDialog
        open={welcomeOpen}
        identity="personal"
        to={deal.client?.email ?? ''}
        subject={wonWelcomeDraft.subject}
        body={wonWelcomeDraft.body}
        dedupeKey={`won:${deal.id}`}
        onClose={() => setWelcomeOpen(false)}
      />

      <CloseDealDialog
        dealId={closeOpen ? dealId : null}
        dealLabel={deal.client?.name ?? deal.title ?? ''}
        onClose={() => setCloseOpen(false)}
      />

      <Tabs defaultValue="overview" className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <DetailTabsList>
          <TabsTrigger value="overview" className={detailTabTriggerClass}>
            {t('tabs.overview')}
          </TabsTrigger>
          <TabsTrigger value="payment" className={detailTabTriggerClass}>
            {t('tabs.payment')}
          </TabsTrigger>
          <TabsTrigger value="jobs" className={detailTabTriggerClass}>
            {t('tabs.jobs')}
          </TabsTrigger>
          <TabsTrigger value="tasks" className={detailTabTriggerClass}>
            {t('tabs.tasks')}
          </TabsTrigger>
          <TabsTrigger value="attachments" className={detailTabTriggerClass}>
            {t('tabs.attachments')}
          </TabsTrigger>
          <TabsTrigger value="activity" className={detailTabTriggerClass}>
            {t('tabs.activity')}
          </TabsTrigger>
          <TabsTrigger value="offers" className={detailTabTriggerClass}>
            {t('tabs.offers', { defaultValue: 'Offers' })}
          </TabsTrigger>
          <TabsTrigger value="contracts" className={detailTabTriggerClass}>
            {tContracts('tab.title')}
          </TabsTrigger>
        </DetailTabsList>

        <TabsContent value="overview" className="mt-1 outline-none lg:min-h-0 lg:flex-1 lg:overflow-hidden">
          <div className={`${detailOverviewWithCommentsGridClass} lg:h-full lg:min-h-0`}>
            <div className="min-w-0 space-y-3 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pr-1">
              <DealForm initial={deal} />
              <DealNotesArea deal={deal} />
              <DealServiceInfo dealId={dealId} />
              <DealServiceAttachments dealId={dealId} />
              <section className="min-w-0 rounded-xl border border-border/60 bg-card p-3 shadow-sm">
                <JobsBillingPanel
                  dealId={dealId}
                  defaultVatRate={deal.client?.country === 'Greece' ? 24 : 0}
                  readOnly={!canManageBilling}
                  invoicedDate={deal.invoiced_date ?? null}
                />
              </section>
            </div>
            <aside className="min-w-0 lg:h-full lg:min-h-0">
              <div className={cn(commentsPanelShellClass, 'lg:h-full lg:min-h-0')}>
                <div className={commentsPanelHeaderClass}>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {tLeads('tabs.comments')}
                  </h2>
                </div>
                <div className={commentsPanelBodyClass}>
                  <CommentsPanel parentType="deal" parentId={dealId} />
                </div>
              </div>
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="payment" className="mt-3 space-y-4 outline-none lg:min-h-0 lg:overflow-y-auto">
          {canManageBilling && (
            <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
              <JobsBillingPanel
                dealId={dealId}
                defaultVatRate={deal.client?.country === 'Greece' ? 24 : 0}
                invoicedDate={deal.invoiced_date ?? null}
              />
            </div>
          )}
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <PaymentsPanel
              dealId={dealId}
              services={dealServices}
              defaultVatRate={deal.client?.country === 'Greece' ? 24 : 0}
            />
          </div>
        </TabsContent>

        <TabsContent value="jobs" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <JobsTab dealId={dealId} accountingCompletedAt={deal.accounting_completed_at} />
          </div>
        </TabsContent>
        <TabsContent value="tasks" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <AssignedTasksTab source={{ kind: 'deal', id: dealId }} />
          </div>
        </TabsContent>
        <TabsContent value="attachments" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <AttachmentsPanel parentType="deal" parentId={dealId} />
          </div>
        </TabsContent>
        <TabsContent value="activity" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <ActivityPanel entityType="deals" entityId={dealId} />
          </div>
        </TabsContent>
        <TabsContent value="offers" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <OffersTab dealId={dealId} />
          </div>
        </TabsContent>
        <TabsContent value="contracts" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            {deal.client_id && <ContractsTab clientId={deal.client_id} />}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
