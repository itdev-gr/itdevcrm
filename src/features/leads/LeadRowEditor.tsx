import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { FilterSelect } from '@/components/layout/page-shell';
import { INDUSTRIES } from '@/lib/industries';
import { stageAccent } from '@/lib/stage-colors';
import { cn } from '@/lib/utils';
import { isStageMoveBlocked } from '@/features/sales/stageAccess';
import { useUpdateLead } from './hooks/useUpdateLead';
import { fieldInputClass, tableSelectClass } from './leadsTableLayout';
import type { LeadRow } from './hooks/useLeads';
import type { AssignableOwner } from './hooks/useAssignableOwners';
import type { StageRow } from '@/features/stages/hooks/usePipelineStages';

const UNASSIGNED = '__unassigned__';
const SOURCES = ['manual', 'meta', 'import', 'franchise'] as const;

const cellClass = 'px-3 py-2.5 align-middle';
const sectionBorder = 'border-l border-border/50';

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
  const savedTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  // Clear the "Saved" fade-out timer on unmount so it never fires setState on
  // an unmounted row (rows churn as the leads table paginates/filters).
  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    },
    [],
  );

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
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = window.setTimeout(() => setSaved(false), 1200);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <tr
      className={cn(
        'group border-b border-border/40 transition-colors last:border-b-0 hover:bg-muted/35',
        selected && 'bg-[#1a9696]/5',
      )}
    >
      <td className={cellClass}>
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggleSelect(lead.id, e.target.checked)}
          aria-label="select"
        />
      </td>
      <td className={cellClass}>
        <Link
          to={`/leads/${lead.id}`}
          className="inline-flex rounded-md bg-muted/60 px-2 py-0.5 font-mono text-xs font-medium text-[#157777] hover:bg-[#1a9696]/10 dark:text-[#7ad4d4]"
        >
          {lead.code ?? t('table.open')}
        </Link>
      </td>
      <td className={cellClass}>
        <FilterSelect
          value={lead.source ?? 'manual'}
          onChange={(e) => commit({ source: e.target.value })}
          className={cn(tableSelectClass, 'min-w-[96px]')}
        >
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`form.source_options.${s}`)}
            </option>
          ))}
        </FilterSelect>
      </td>
      <td className={cellClass}>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={fieldInputClass}
          title={title || undefined}
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
      <td className={cellClass}>
        <Input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className={fieldInputClass}
          title={fullName || undefined}
          onBlur={() => {
            const v = fullName.trim();
            const cur = [lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(' ');
            if (v !== cur) void commit({ contact_first_name: v || null, contact_last_name: null });
          }}
        />
      </td>
      <td className={cn(cellClass, sectionBorder)}>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={cn(fieldInputClass, 'font-mono text-xs tracking-tight')}
          title={email || undefined}
          spellCheck={false}
          onBlur={() => {
            if (email.trim() !== (lead.email ?? '')) void commit({ email: email.trim() || null });
          }}
        />
      </td>
      <td className={cellClass}>
        <Input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={cn(fieldInputClass, 'tabular-nums')}
          title={phone || undefined}
          onBlur={() => {
            if (phone.trim() !== (lead.phone ?? '')) void commit({ phone: phone.trim() || null });
          }}
        />
      </td>
      <td className={cellClass}>
        <Input
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className={cn(fieldInputClass, 'text-xs')}
          title={website || undefined}
          spellCheck={false}
          onBlur={() => {
            if (website.trim() !== (lead.website ?? '')) void commit({ website: website.trim() || null });
          }}
        />
      </td>
      <td className={cn(cellClass, sectionBorder)}>
        <FilterSelect
          value={lead.industry ?? ''}
          onChange={(e) => commit({ industry: e.target.value || null })}
          className={tableSelectClass}
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
      <td className={cellClass}>
        <Input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className={fieldInputClass}
          title={company || undefined}
          onBlur={() => {
            if (company.trim() !== (lead.company_name ?? ''))
              void commit({ company_name: company.trim() || null });
          }}
        />
      </td>
      <td className={cn(cellClass, sectionBorder)}>
        <FilterSelect
          value={lead.owner_user_id ?? UNASSIGNED}
          onChange={(e) =>
            commit({ owner_user_id: e.target.value === UNASSIGNED ? null : e.target.value })
          }
          className={cn(tableSelectClass, 'min-w-[148px]')}
        >
          <option value={UNASSIGNED}>{t('owner.unassigned')}</option>
          {owners.map((o) => (
            <option key={o.user_id} value={o.user_id}>
              {o.full_name || o.email}
            </option>
          ))}
        </FilterSelect>
      </td>
      <td className={cellClass}>
        <div className={cn('rounded-lg border-l-[3px] pl-2', statusAccent.columnBorder.replace('border-t-', 'border-l-'))}>
          <FilterSelect
            value={lead.stage_id ?? ''}
            onChange={(e) => commit({ stage_id: e.target.value })}
            className={cn(tableSelectClass, 'min-w-[140px]')}
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
