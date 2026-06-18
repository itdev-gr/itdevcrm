import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { FilterSelect } from '@/components/layout/page-shell';
import { INDUSTRIES } from '@/lib/industries';
import { stageAccent } from '@/lib/stage-colors';
import { cn } from '@/lib/utils';
import { isStageMoveBlocked } from '@/features/sales/stageAccess';
import { useUpdateLead } from './hooks/useUpdateLead';
import type { LeadRow } from './hooks/useLeads';
import type { AssignableOwner } from './hooks/useAssignableOwners';
import type { StageRow } from '@/features/stages/hooks/usePipelineStages';

const UNASSIGNED = '__unassigned__';
const SOURCES = ['manual', 'meta', 'import'] as const;

const fieldInputClass =
  'h-8 rounded-lg border-input/70 bg-background text-sm shadow-none focus-visible:border-[#1a9696]/40 focus-visible:ring-[#1a9696]/20';

type Props = {
  lead: LeadRow;
  owners: AssignableOwner[];
  stages: StageRow[];
  currentUserId: string | null;
  lang: 'en' | 'el';
  selected: boolean;
  onToggleSelect: (id: string, checked: boolean) => void;
};

export function LeadRowEditor({
  lead,
  owners,
  stages,
  currentUserId,
  lang,
  selected,
  onToggleSelect,
}: Props) {
  const { t } = useTranslation('leads');
  const update = useUpdateLead();
  const [saved, setSaved] = useState(false);

  const [title, setTitle] = useState(lead.title ?? '');
  const [fullName, setFullName] = useState(
    [lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(' '),
  );
  const [email, setEmail] = useState(lead.email ?? '');
  const [phone, setPhone] = useState(lead.phone ?? '');
  const [website, setWebsite] = useState(lead.website ?? '');
  const [company, setCompany] = useState(lead.company_name ?? '');

  const currentStage = stages.find((s) => s.id === lead.stage_id);
  const statusAccent = stageAccent(currentStage?.code);

  async function commit(patch: Record<string, unknown>) {
    try {
      await update.mutateAsync({ id: lead.id, patch });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1200);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <tr className={cn('transition-colors hover:bg-muted/30', selected && 'bg-[#1a9696]/5')}>
      <td className="px-3 py-2 align-top">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggleSelect(lead.id, e.target.checked)}
          aria-label="select"
        />
      </td>
      <td className="px-3 py-2 align-top">
        <Link
          to={`/leads/${lead.id}`}
          className="inline-flex rounded-md bg-muted/60 px-2 py-0.5 font-mono text-xs font-medium text-[#157777] hover:bg-[#1a9696]/10 dark:text-[#7ad4d4]"
        >
          {lead.code ?? t('table.open')}
        </Link>
      </td>
      <td className="px-3 py-2 align-top">
        <FilterSelect
          value={lead.source ?? 'manual'}
          onChange={(e) => commit({ source: e.target.value })}
          className="h-8 w-full min-w-[100px] text-xs"
        >
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`form.source_options.${s}`)}
            </option>
          ))}
        </FilterSelect>
      </td>
      <td className="px-3 py-2 align-top">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={fieldInputClass}
          onBlur={() => {
            const v = title.trim();
            if (!v) {
              setTitle(lead.title ?? '');
              return;
            }
            if (v !== (lead.title ?? '')) void commit({ title: v });
          }}
        />
      </td>
      <td className="px-3 py-2 align-top">
        <Input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className={fieldInputClass}
          onBlur={() => {
            const v = fullName.trim();
            const cur = [lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(' ');
            if (v !== cur) void commit({ contact_first_name: v || null, contact_last_name: null });
          }}
        />
      </td>
      <td className="px-3 py-2 align-top">
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={fieldInputClass}
          onBlur={() => {
            if (email.trim() !== (lead.email ?? '')) void commit({ email: email.trim() || null });
          }}
        />
      </td>
      <td className="px-3 py-2 align-top">
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={fieldInputClass}
          onBlur={() => {
            if (phone.trim() !== (lead.phone ?? '')) void commit({ phone: phone.trim() || null });
          }}
        />
      </td>
      <td className="px-3 py-2 align-top">
        <Input
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className={fieldInputClass}
          onBlur={() => {
            if (website.trim() !== (lead.website ?? '')) void commit({ website: website.trim() || null });
          }}
        />
      </td>
      <td className="px-3 py-2 align-top">
        <FilterSelect
          value={lead.industry ?? ''}
          onChange={(e) => commit({ industry: e.target.value || null })}
          className="h-8 w-full text-xs"
        >
          <option value="">—</option>
          {INDUSTRIES.map((ind) => (
            <option key={ind.code} value={ind.code}>
              {ind.labels[lang]}
            </option>
          ))}
          {lead.industry && !INDUSTRIES.some((i) => i.code === lead.industry) && (
            <option value={lead.industry}>{lead.industry} (legacy)</option>
          )}
        </FilterSelect>
      </td>
      <td className="px-3 py-2 align-top">
        <Input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className={fieldInputClass}
          onBlur={() => {
            if (company.trim() !== (lead.company_name ?? ''))
              void commit({ company_name: company.trim() || null });
          }}
        />
      </td>
      <td className="px-3 py-2 align-top">
        <FilterSelect
          value={lead.owner_user_id ?? UNASSIGNED}
          onChange={(e) =>
            commit({ owner_user_id: e.target.value === UNASSIGNED ? null : e.target.value })
          }
          className="h-8 w-full min-w-[140px] text-xs"
        >
          <option value={UNASSIGNED}>{t('owner.unassigned')}</option>
          {owners.map((o) => (
            <option key={o.user_id} value={o.user_id}>
              {o.full_name || o.email}
            </option>
          ))}
        </FilterSelect>
      </td>
      <td className="px-3 py-2 align-top">
        <div className={cn('rounded-lg border-l-[3px] pl-2', statusAccent.columnBorder.replace('border-t-', 'border-l-'))}>
          <FilterSelect
            value={lead.stage_id ?? ''}
            onChange={(e) => commit({ stage_id: e.target.value })}
            className="h-8 w-full min-w-[140px] text-xs"
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id} disabled={isStageMoveBlocked(s, currentUserId)}>
                {s.display_names[lang] ?? s.code}
              </option>
            ))}
          </FilterSelect>
          {saved && <span className="text-[10px] font-medium text-emerald-600">{t('table.saved')}</span>}
        </div>
      </td>
    </tr>
  );
}
