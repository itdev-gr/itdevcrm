import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import type { LeadRow } from '@/features/leads/hooks/useLeads';
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';

export function SalesKanbanCard({ lead }: { lead: LeadRow }) {
  const { t } = useTranslation('leads');
  const { data: owners = [] } = useAssignableOwners();
  const owner = lead.owner_user_id ? owners.find((o) => o.user_id === lead.owner_user_id) : null;
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
  const subtitleParts = [contactName ? lead.company_name : null, lead.industry].filter(Boolean);
  const companyAndCategory = subtitleParts.join(' · ');

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card className="cursor-grab active:cursor-grabbing">
        <CardContent className="space-y-1 p-3">
          <div className="flex items-center justify-between">
            <Link to={`/leads/${lead.id}`} className="text-sm font-medium hover:underline">
              {fullName}
            </Link>
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
            👤 {owner ? owner.full_name || owner.email : t('owner.unassigned')}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
