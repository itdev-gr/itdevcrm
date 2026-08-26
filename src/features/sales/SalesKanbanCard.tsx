import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Calendar, CheckCircle2, Phone, User } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { CopyableCode } from '@/components/CopyableCode';
import type { LeadRow } from '@/features/leads/hooks/useLeads';
import { formatDate, relativeFromNow } from '@/lib/datetime';
import { industryLabel } from '@/lib/industries';
import { SOURCE_BADGE } from '@/lib/stage-colors';
import { cn } from '@/lib/utils';
import type { PlannedService } from '@/features/deals/ServicesPlannedField';
import { CallLink } from '@/components/CallLink';

export function SalesKanbanCard({
  lead,
  ownerName,
  wonByName,
  cadenceBadge,
}: {
  lead: LeadRow;
  ownerName?: string;
  wonByName?: string;
  /** UD board only: the lead's next-step / needs-decision line. */
  cadenceBadge?: React.ReactNode;
}) {
  const { t, i18n } = useTranslation('leads');
  const { t: tDeals } = useTranslation('deals');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const isWon = lead.stage?.code === 'won';
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    data: { lead, leadId: lead.id, currentStage: lead.stage_id },
  });
  const style = transform
    ? { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.5 : 1 }
    : undefined;

  const contactName = [lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(' ');
  const fullName = contactName || lead.company_name || lead.title;
  const industryDisplay = industryLabel(lead.industry, lang);
  const subtitleParts = [contactName ? lead.company_name : null, industryDisplay].filter(Boolean);
  const companyAndCategory = subtitleParts.join(' · ');
  const services: PlannedService[] = Array.isArray(lead.services_planned)
    ? (lead.services_planned as unknown as PlannedService[])
    : [];
  const oneTime = Number(lead.estimated_one_time_value ?? 0);
  const monthly = Number(lead.estimated_monthly_value ?? 0);

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card
        size="sm"
        className="cursor-grab gap-0 py-0 ring-border/60 transition-shadow hover:shadow-md active:cursor-grabbing"
      >
        <CardContent className="space-y-2.5 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {lead.code && <CopyableCode code={lead.code} className="text-[10px]" />}
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                    SOURCE_BADGE[lead.source ?? 'manual'] ?? SOURCE_BADGE.manual,
                  )}
                >
                  {lead.source ?? 'manual'}
                </span>
              </div>
              <Link to={`/leads/${lead.id}`} className="block truncate text-sm font-semibold hover:text-[#157777] dark:hover:text-[#7ad4d4]">
                {fullName}
              </Link>
            </div>
            {lead.converted_at && (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-hidden />
            )}
          </div>

          {companyAndCategory && (
            <p className="truncate text-xs text-muted-foreground">{companyAndCategory}</p>
          )}

          {(oneTime > 0 || monthly > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {oneTime > 0 && (
                <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                  €{oneTime.toFixed(0)}
                </span>
              )}
              {monthly > 0 && (
                <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
                  €{monthly.toFixed(0)}
                  {t('card.monthly')}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <User className="size-3.5 shrink-0 opacity-70" />
            <span className="truncate">{ownerName || t('owner.unassigned')}</span>
          </div>

          {lead.phone && (
            <div className="flex items-center gap-1.5 text-[11px]" onClick={(e) => e.stopPropagation()}>
              <Phone className="size-3.5 shrink-0 text-[#1a9696]" />
              <CallLink phone={lead.phone} />
            </div>
          )}

          {services.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {services.map((s) => tDeals(`services.types.${s.service_type}`)).join(' · ')}
            </p>
          )}

          {isWon && wonByName && (
            <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
              {t('sales_person.label')}: {wonByName}
            </p>
          )}

          {lead.scheduled_for && (
            <p
              className="flex items-center gap-1.5 text-[10px] font-medium text-blue-700 dark:text-blue-400"
              title={new Date(lead.scheduled_for).toLocaleString()}
            >
              <Calendar className="size-3 shrink-0" />
              {lead.stage?.code === 'offer_sent' ? 'Follow-up' : 'Scheduled'}:{' '}
              {formatDate(lead.scheduled_for)}{' '}
              {new Intl.DateTimeFormat(lang === 'el' ? 'el-GR' : 'en-US', {
                hour: '2-digit',
                minute: '2-digit',
              }).format(new Date(lead.scheduled_for))}
            </p>
          )}

          {cadenceBadge}

          <div
            className="flex items-center gap-1.5 border-t border-border/50 pt-2 text-[10px] text-muted-foreground"
            title={formatDate(lead.created_at)}
          >
            <Calendar className="size-3 shrink-0 opacity-70" />
            {relativeFromNow(lead.created_at)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
