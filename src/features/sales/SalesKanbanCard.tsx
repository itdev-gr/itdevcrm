import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import { CopyableCode } from '@/components/CopyableCode';
import type { LeadRow } from '@/features/leads/hooks/useLeads';
import { formatDate, relativeFromNow } from '@/lib/datetime';
import { industryLabel } from '@/lib/industries';
import type { PlannedService } from '@/features/deals/ServicesPlannedField';
import { CallLink } from '@/components/CallLink';

export function SalesKanbanCard({
  lead,
  ownerName,
  wonByName,
}: {
  lead: LeadRow;
  ownerName?: string;
  wonByName?: string;
}) {
  const { t, i18n } = useTranslation('leads');
  const { t: tDeals } = useTranslation('deals');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const isWon = lead.stage?.code === 'won';
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    data: { leadId: lead.id, currentStage: lead.stage_id },
  });
  const style = transform
    ? { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.5 : 1 }
    : undefined;

  const contactName = [lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(' ');
  // Title falls back to company name when contact name is missing (Meta leads
  // sometimes only carry a phone + company), then to the lead.title last.
  const fullName = contactName || lead.company_name || lead.title;
  // Avoid showing the company name twice when it's already the title.
  const industryDisplay = industryLabel(lead.industry, lang);
  const subtitleParts = [contactName ? lead.company_name : null, industryDisplay].filter(Boolean);
  const companyAndCategory = subtitleParts.join(' · ');
  const services: PlannedService[] = Array.isArray(lead.services_planned)
    ? (lead.services_planned as unknown as PlannedService[])
    : [];

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card className="cursor-grab active:cursor-grabbing">
        <CardContent className="space-y-1 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {lead.code && <CopyableCode code={lead.code} className="text-[10px]" />}
              <Link
                to={`/leads/${lead.id}`}
                className="truncate text-sm font-medium hover:underline"
              >
                {fullName}
              </Link>
            </div>
            {lead.converted_at && <span className="text-xs text-emerald-600">✓</span>}
          </div>
          {companyAndCategory && (
            <div className="text-xs text-muted-foreground">{companyAndCategory}</div>
          )}
          <div className="text-xs">
            {Number(lead.estimated_one_time_value ?? 0) > 0 && (
              <span>€{Number(lead.estimated_one_time_value).toFixed(0)}</span>
            )}
            {Number(lead.estimated_monthly_value ?? 0) > 0 && (
              <span className="ml-2">
                €{Number(lead.estimated_monthly_value).toFixed(0)}
                {t('card.monthly')}
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-500">
            👤 {ownerName || t('owner.unassigned')}
          </div>
          {lead.phone && (
            <div className="text-[10px]">
              <span onClick={(e) => e.stopPropagation()}><CallLink phone={lead.phone} /></span>
            </div>
          )}
          {services.length > 0 && (
            <div className="text-[10px] text-slate-500">
              {services.map((s) => tDeals(`services.types.${s.service_type}`)).join(' · ')}
            </div>
          )}
          {isWon && wonByName && (
            <div className="text-[10px] text-emerald-700">
              {t('sales_person.label')}: {wonByName}
            </div>
          )}
          {lead.scheduled_for && (
            <div
              className="text-[10px] font-medium text-blue-700"
              title={new Date(lead.scheduled_for).toLocaleString()}
            >
              📞 {lead.stage?.code === 'offer_sent' ? 'Follow-up' : 'Scheduled'}:{' '}
              {formatDate(lead.scheduled_for)}{' '}
              {new Intl.DateTimeFormat(lang === 'el' ? 'el-GR' : 'en-US', {
                hour: '2-digit',
                minute: '2-digit',
              }).format(new Date(lead.scheduled_for))}
            </div>
          )}
          <div className="text-[10px] text-slate-400" title={formatDate(lead.created_at)}>
            🗓 {relativeFromNow(lead.created_at)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
