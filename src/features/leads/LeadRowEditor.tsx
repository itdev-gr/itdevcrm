import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { INDUSTRIES } from '@/lib/industries';
import { isStageMoveBlocked } from '@/features/sales/stageAccess';
import { useUpdateLead } from './hooks/useUpdateLead';
import type { LeadRow } from './hooks/useLeads';
import type { AssignableOwner } from './hooks/useAssignableOwners';
import type { StageRow } from '@/features/stages/hooks/usePipelineStages';

const UNASSIGNED = '__unassigned__';
const SOURCES = ['manual', 'meta', 'import'] as const;

type Props = {
  lead: LeadRow;
  owners: AssignableOwner[];
  stages: StageRow[];
  currentUserId: string | null;
  lang: 'en' | 'el';
  selected: boolean;
  onToggleSelect: (id: string, checked: boolean) => void;
};

export function LeadRowEditor({ lead, owners, stages, currentUserId, lang, selected, onToggleSelect }: Props) {
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

  async function commit(patch: Record<string, unknown>) {
    try {
      await update.mutateAsync({ id: lead.id, patch });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1200);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const td = 'border-b px-1 py-1 align-top';

  return (
    <tr>
      <td className={td}>
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggleSelect(lead.id, e.target.checked)}
          aria-label="select"
        />
      </td>
      <td className={td}>
        <Link to={`/leads/${lead.id}`} className="font-mono text-xs text-blue-600 underline">
          {lead.code ?? t('table.open')}
        </Link>
      </td>
      <td className={td}>
        <select
          value={lead.source ?? 'manual'}
          onChange={(e) => commit({ source: e.target.value })}
          className="w-full rounded border border-input bg-background px-1 py-1 text-sm"
        >
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`form.source_options.${s}`)}
            </option>
          ))}
        </select>
      </td>
      <td className={td}>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const v = title.trim();
            if (!v) {
              setTitle(lead.title ?? ''); // required → revert
              return;
            }
            if (v !== (lead.title ?? '')) void commit({ title: v });
          }}
        />
      </td>
      <td className={td}>
        <Input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          onBlur={() => {
            const v = fullName.trim();
            const cur = [lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(' ');
            if (v !== cur) void commit({ contact_first_name: v || null, contact_last_name: null });
          }}
        />
      </td>
      <td className={td}>
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => { if (email.trim() !== (lead.email ?? '')) void commit({ email: email.trim() || null }); }}
        />
      </td>
      <td className={td}>
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={() => { if (phone.trim() !== (lead.phone ?? '')) void commit({ phone: phone.trim() || null }); }}
        />
      </td>
      <td className={td}>
        <Input
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          onBlur={() => { if (website.trim() !== (lead.website ?? '')) void commit({ website: website.trim() || null }); }}
        />
      </td>
      <td className={td}>
        <select
          value={lead.industry ?? ''}
          onChange={(e) => commit({ industry: e.target.value || null })}
          className="w-full rounded border border-input bg-background px-1 py-1 text-sm"
        >
          <option value="">—</option>
          {INDUSTRIES.map((ind) => (
            <option key={ind.code} value={ind.code}>{ind.labels[lang]}</option>
          ))}
          {lead.industry && !INDUSTRIES.some((i) => i.code === lead.industry) && (
            <option value={lead.industry}>{lead.industry} (legacy)</option>
          )}
        </select>
      </td>
      <td className={td}>
        <Input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          onBlur={() => { if (company.trim() !== (lead.company_name ?? '')) void commit({ company_name: company.trim() || null }); }}
        />
      </td>
      <td className={td}>
        <select
          value={lead.owner_user_id ?? UNASSIGNED}
          onChange={(e) => commit({ owner_user_id: e.target.value === UNASSIGNED ? null : e.target.value })}
          className="w-full rounded border border-input bg-background px-1 py-1 text-sm"
        >
          <option value={UNASSIGNED}>{t('owner.unassigned')}</option>
          {owners.map((o) => (
            <option key={o.user_id} value={o.user_id}>{o.full_name || o.email}</option>
          ))}
        </select>
      </td>
      <td className={td}>
        <select
          value={lead.stage_id ?? ''}
          onChange={(e) => commit({ stage_id: e.target.value })}
          className="w-full rounded border border-input bg-background px-1 py-1 text-sm"
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id} disabled={isStageMoveBlocked(s, currentUserId)}>
              {s.display_names[lang] ?? s.code}
            </option>
          ))}
        </select>
        {saved && <span className="ml-1 text-[10px] text-emerald-600">{t('table.saved')}</span>}
      </td>
    </tr>
  );
}
