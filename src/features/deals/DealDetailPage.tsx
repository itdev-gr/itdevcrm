import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { DealForm } from './DealForm';
import { useDeal } from './hooks/useDeal';
import { useMoveAccountingStage } from '@/features/accounting/hooks/useMoveAccountingStage';
import { useCompleteAccounting } from '@/features/accounting/hooks/useCompleteAccounting';
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { PaymentsPanel } from './PaymentsPanel';
import type { PlannedService } from './ServicesPlannedField';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { ActivityPanel } from '@/features/activity/ActivityPanel';
import { formatDate, relativeFromNow } from '@/lib/datetime';
import { useAuthStore } from '@/lib/stores/authStore';
import { CopyableCode } from '@/components/CopyableCode';
import { supabase } from '@/lib/supabase';
import { OffersTab } from '@/features/offers/OffersTab';
import { JobsTab } from '@/features/jobs/JobsTab';
import { AssignedTasksTab } from '@/features/assigned_tasks/AssignedTasksTab';

const UNASSIGNED = '__unassigned__';

export function DealDetailPage() {
  const { dealId = '' } = useParams<{ dealId: string }>();
  const { t, i18n } = useTranslation('deals');
  const { t: tLeads } = useTranslation('leads');
  const { t: tAccounting } = useTranslation('accounting');
  const { t: tClients } = useTranslation('clients');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: deal, isLoading, error } = useDeal(dealId);
  const moveAccounting = useMoveAccountingStage();
  const complete = useCompleteAccounting();
  const { data: owners = [] } = useAssignableOwners();
  const { data: stages = [] } = usePipelineStages();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const wonBy = deal?.won_by_user_id
    ? owners.find((o) => o.user_id === deal.won_by_user_id)
    : null;

  if (isLoading) return <div className="p-8">…</div>;
  if (error || !deal)
    return <div className="p-8 text-red-600">{error?.message ?? 'Not found'}</div>;

  const completed = !!deal.accounting_completed_at;
  const onAccountingKanban = !!deal.accounting_stage_id && !completed;
  const dealServices: PlannedService[] = Array.isArray(deal.services_planned)
    ? (deal.services_planned as unknown as PlannedService[])
    : [];

  const accStages = stages
    .filter((s) => s.board === 'accounting_onboarding' && !s.archived)
    .sort((a, b) => a.position - b.position);
  const paidStage = accStages.find((s) => s.code === 'paid_in_full');

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
    if (!deal || !targetStageId || targetStageId === deal.accounting_stage_id) return;
    if (!deal.payment_method) {
      alert(tAccounting('kanban.move_errors.payment_method_required'));
      return;
    }
    if (paidStage && targetStageId === paidStage.id) {
      try {
        await complete.mutateAsync(dealId);
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
    <div className="flex min-h-full flex-col gap-6 p-8 lg:h-full lg:min-h-0 lg:overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-3">
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-purple-700">
              Deal
            </span>
            {deal.code && <CopyableCode code={deal.code} className="text-xs" />}
            <h1 className="text-2xl font-bold">{deal.title}</h1>
          </div>
          <p className="text-xs text-slate-500">
            🗓 {formatDate(deal.created_at)} · {relativeFromNow(deal.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="client-status" className="text-sm">
              {tClients('status.label')}:
            </Label>
            <select
              id="client-status"
              value={deal.client?.status ?? 'new'}
              onChange={(e) => onChangeClientStatus(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              <option value="new">{tClients('status.new')}</option>
              <option value="active">{tClients('status.active')}</option>
              <option value="blocked">{tClients('status.blocked')}</option>
              <option value="done">{tClients('status.done')}</option>
            </select>
          </div>
          {wonBy && (
            <div className="flex items-center gap-2">
              <Label className="text-sm">{tLeads('sales_person.label')}:</Label>
              <span className="rounded-md border border-input bg-slate-50 px-2 py-1 text-sm text-slate-700">
                {wonBy.full_name || wonBy.email}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Label htmlFor="owner" className="text-sm">
              {tLeads('owner.label')}:
            </Label>
            <select
              id="owner"
              value={deal.owner_user_id ?? UNASSIGNED}
              onChange={(e) => onChangeOwner(e.target.value)}
              disabled={completed}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              <option value={UNASSIGNED}>{tLeads('owner.unassigned')}</option>
              {owners.map((o) => (
                <option key={o.user_id} value={o.user_id}>
                  {o.full_name || o.email}
                  {o.is_admin ? ' · admin' : ''}
                </option>
              ))}
            </select>
          </div>
          {onAccountingKanban && accStages.length > 0 && (
            <div className="flex items-center gap-2">
              <Label htmlFor="acc-stage" className="text-sm">
                {tLeads('actions.move_to')}:
              </Label>
              <select
                id="acc-stage"
                value={deal.accounting_stage_id ?? ''}
                onChange={(e) => onChangeAccountingStage(e.target.value)}
                disabled={moveAccounting.isPending || complete.isPending}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                {accStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {(s.display_names as { en?: string; el?: string })[lang] ?? s.code}
                  </option>
                ))}
              </select>
            </div>
          )}
          {completed && (
            <span className="text-sm text-emerald-700">✓ {tAccounting('actions.complete')}</span>
          )}
          {isAdmin && deal.locked_at && (
            <span className="text-xs text-slate-500" title={formatDate(deal.locked_at)}>
              🔒 {relativeFromNow(deal.locked_at)}
            </span>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview" className="lg:min-h-0 lg:flex-1">
        <TabsList>
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="payment">{t('tabs.payment')}</TabsTrigger>
          <TabsTrigger value="jobs">{t('tabs.jobs')}</TabsTrigger>
          <TabsTrigger value="tasks">{t('tabs.tasks')}</TabsTrigger>
          <TabsTrigger value="attachments">{t('tabs.attachments')}</TabsTrigger>
          <TabsTrigger value="activity">{t('tabs.activity')}</TabsTrigger>
          <TabsTrigger value="offers">Offers</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4 lg:min-h-0 lg:overflow-hidden">
          <div className="grid grid-cols-1 gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[65%_35%]">
            <div className="min-w-0 lg:h-full lg:overflow-y-auto lg:pr-6">
              <DealForm initial={deal} />
            </div>
            <aside className="min-w-0 lg:flex lg:h-full lg:flex-col lg:border-l lg:pl-6">
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">
                {tLeads('tabs.comments')}
              </h2>
              <CommentsPanel parentType="deal" parentId={dealId} />
            </aside>
          </div>
        </TabsContent>
        <TabsContent value="payment" className="pt-4 lg:min-h-0 lg:overflow-y-auto">
          <PaymentsPanel
            dealId={dealId}
            services={dealServices}
            defaultVatRate={deal.client?.country === 'Greece' ? 24 : 0}
          />
        </TabsContent>
        <TabsContent value="jobs" className="pt-4 lg:min-h-0 lg:overflow-y-auto">
          <JobsTab dealId={dealId} accountingCompletedAt={deal.accounting_completed_at} />
        </TabsContent>
        <TabsContent value="tasks" className="pt-4 lg:min-h-0 lg:overflow-y-auto">
          <AssignedTasksTab source={{ kind: 'deal', id: dealId }} />
        </TabsContent>
        <TabsContent value="attachments" className="pt-4 lg:min-h-0 lg:overflow-y-auto">
          <AttachmentsPanel parentType="deal" parentId={dealId} />
        </TabsContent>
        <TabsContent value="activity" className="pt-4 lg:min-h-0 lg:overflow-y-auto">
          <ActivityPanel entityType="deals" entityId={dealId} />
        </TabsContent>
        <TabsContent value="offers" className="pt-4 lg:min-h-0 lg:overflow-y-auto">
          <OffersTab dealId={dealId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
