import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useActivityLog } from './hooks/useActivityLog';
import { useMentionableUsers } from '@/features/comments/hooks/useMentionableUsers';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';

type Props = { entityType: string; entityId: string };

const HIDDEN_FIELDS = new Set([
  'updated_at',
  'created_at',
  'archived_at',
  'archived_by',
  'archived_reason',
  'created_by',
  // System-managed columns nobody needs to see in the activity log:
  'code',
  'id',
  'source_data',
  'converted_client_id',
  'converted_deal_id',
]);

const STAGE_FIELDS = new Set(['stage_id', 'accounting_stage_id']);
const USER_FIELDS = new Set([
  'owner_user_id',
  'assigned_owner_id',
  'won_by_user_id',
  'locked_by',
  'accounting_completed_by',
  'archived_by',
  'created_by',
  'blocked_by',
  'unblocked_by',
  'author_id',
]);

const FIELD_LABELS: Record<string, string> = {
  stage_id: 'Stage',
  owner_user_id: 'Owner',
  contact_first_name: 'Contact name',
  contact_last_name: 'Last name',
  email: 'Email',
  phone: 'Phone',
  website: 'Website',
  company_name: 'Company',
  industry: 'Industry',
  country: 'Country',
  address: 'Address',
  vat_number: 'VAT',
  notes: 'Lead info',
  additional_notes: 'Notes',
  estimated_one_time_value: 'One-time €',
  estimated_monthly_value: 'Monthly €',
  services_planned: 'Services',
  expected_close_date: 'Expected close',
  source: 'Source',
  source_data: 'Source data',
  title: 'Title',
  converted_at: 'Converted at',
  converted_client_id: 'Linked client',
  converted_deal_id: 'Linked deal',
  won_by_user_id: 'Won by',
  archived: 'Archived',
  read_at: 'Read at',
  body: 'Body',
  mentioned_user_ids: 'Mentions',
};

type Resolver = {
  stages: { id: string; code: string; display_names: unknown }[];
  users: { user_id: string; full_name: string; email: string }[];
  lang: 'en' | 'el';
};

function pretty(value: unknown, field: string, resolver: Resolver): string {
  if (value === null || value === undefined || value === '') return '—';
  // Resolve common id fields to friendly names so the diff isn't a wall of UUIDs.
  if (typeof value === 'string') {
    if (STAGE_FIELDS.has(field)) {
      const stage = resolver.stages.find((s) => s.id === value);
      if (stage) {
        const dn = stage.display_names as { en?: string; el?: string };
        return dn?.[resolver.lang] ?? stage.code;
      }
    }
    if (USER_FIELDS.has(field)) {
      const user = resolver.users.find((u) => u.user_id === value);
      if (user) return user.full_name || user.email;
    }
    return value.length > 60 ? value.slice(0, 60) + '…' : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    const j = JSON.stringify(value);
    return j.length > 80 ? j.slice(0, 80) + '…' : j;
  } catch {
    return '[object]';
  }
}

type Diff = { field: string; before: unknown; after: unknown };

function diffOf(changes: unknown): Diff[] {
  if (!changes || typeof changes !== 'object') return [];
  const c = changes as { old?: Record<string, unknown>; new?: Record<string, unknown> };
  if (!c.old || !c.new) return [];
  const result: Diff[] = [];
  for (const key of Object.keys(c.new)) {
    if (HIDDEN_FIELDS.has(key)) continue;
    const before = c.old[key];
    const after = c.new[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      result.push({ field: key, before, after });
    }
  }
  return result;
}

function snapshotFields(changes: unknown): { field: string; value: unknown }[] {
  if (!changes || typeof changes !== 'object') return [];
  const obj = changes as Record<string, unknown>;
  return Object.keys(obj)
    .filter((k) => !HIDDEN_FIELDS.has(k) && obj[k] !== null && obj[k] !== '')
    .map((k) => ({ field: k, value: obj[k] }));
}

export function ActivityPanel({ entityType, entityId }: Props) {
  const { t, i18n } = useTranslation('sales');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: rows = [] } = useActivityLog(entityType, entityId);
  const { data: users = [] } = useMentionableUsers();
  const { data: stages = [] } = usePipelineStages();

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('activity.empty')}</p>;
  }

  const labelEntity = entityType.replace(/s$/, '');
  const resolver: Resolver = { stages, users, lang };

  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const who = r.user?.full_name ?? r.user?.email ?? 'system';
        const when = new Date(r.created_at).toLocaleString(undefined, {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

        let summary: string;
        let body: ReactNode = null;

        if (r.action === 'insert') {
          summary = `created the ${labelEntity}`;
          const fields = snapshotFields(r.changes).slice(0, 6);
          if (fields.length > 0) {
            body = (
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {fields.map((f) => (
                  <li key={f.field}>
                    <span className="font-medium">{FIELD_LABELS[f.field] ?? f.field}:</span>{' '}
                    {pretty(f.value, f.field, resolver)}
                  </li>
                ))}
              </ul>
            );
          }
        } else if (r.action === 'delete') {
          summary = `deleted the ${labelEntity}`;
        } else {
          const diffs = diffOf(r.changes);
          if (diffs.length === 0) {
            summary = 'saved the record (no field changes)';
          } else if (diffs.length === 1) {
            const d = diffs[0]!;
            summary = `changed ${FIELD_LABELS[d.field] ?? d.field}`;
            body = (
              <div className="mt-1 text-xs text-muted-foreground">
                <span className="text-muted-foreground">{pretty(d.before, d.field, resolver)}</span>{' '}
                <span className="text-muted-foreground">→</span>{' '}
                <span className="text-foreground">{pretty(d.after, d.field, resolver)}</span>
              </div>
            );
          } else {
            summary = `changed ${diffs.length} fields`;
            body = (
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {diffs.slice(0, 8).map((d) => (
                  <li key={d.field}>
                    <span className="font-medium">{FIELD_LABELS[d.field] ?? d.field}:</span>{' '}
                    <span className="text-muted-foreground">{pretty(d.before, d.field, resolver)}</span>{' '}
                    <span className="text-muted-foreground">→</span>{' '}
                    <span className="text-foreground">{pretty(d.after, d.field, resolver)}</span>
                  </li>
                ))}
                {diffs.length > 8 && (
                  <li className="italic text-muted-foreground">…and {diffs.length - 8} more</li>
                )}
              </ul>
            );
          }
        }

        return (
          <li key={r.id} className="rounded-md border bg-card p-3 text-sm">
            <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{who}</span>
              <span>{when}</span>
            </div>
            <div className="mt-1">
              <span className="text-foreground">{summary}</span>
            </div>
            {body}
          </li>
        );
      })}
    </ul>
  );
}
