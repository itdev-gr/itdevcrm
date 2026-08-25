// Plain-English rendering for the activity log, shared by ActivityPanel and tests.
// Goal: every entry reads in plain English — no raw column names, UUIDs, JSON,
// booleans-as-true/false, or ISO timestamps — and always names the actor (or
// "System" for automated changes that have no human behind them).

export type Resolver = {
  stages: { id: string; code: string; display_names: unknown }[];
  users: { user_id: string; full_name: string; email: string }[];
  lang: 'en' | 'el';
};

// System / relationship / duplicate columns nobody needs to read in the log.
export const HIDDEN_FIELDS = new Set([
  'id',
  'code',
  'created_at',
  'updated_at',
  'created_by',
  'archived_at',
  'archived_by',
  'source_data',
  'phone_normalized',
  'unsubscribe_token',
  'converted_client_id',
  'converted_deal_id',
  // relationship foreign keys (raw UUIDs, not meaningful as prose)
  'client_id',
  'deal_id',
  'assigned_group_id',
  'billing_group_id',
  // timestamps that merely shadow a status/boolean field
  'locked_at',
  'accounting_completed_at',
  'started_at',
  'completed_at',
  'blocked_at',
  'converted_at',
  'read_at',
  'monthly_tasks_period',
]);

const STAGE_FIELDS = new Set(['stage_id', 'accounting_stage_id']);
const USER_FIELDS = new Set([
  'owner_user_id',
  'assigned_owner_id',
  'won_by_user_id',
  'locked_by',
  'accounting_completed_by',
  'blocked_by',
  'author_id',
]);
const MONEY_FIELDS = new Set([
  'estimated_one_time_value',
  'estimated_monthly_value',
  'estimated_total_value',
  'one_time_value',
  'recurring_monthly_value',
  'one_time_amount',
  'monthly_amount',
  'setup_fee',
  'amount_net',
  'temp_deal_amount',
]);
const DATE_FIELDS = new Set([
  'expected_close_date',
  'actual_close_date',
  'start_date',
  'recurring_start_date',
]);
const DATETIME_FIELDS = new Set(['scheduled_for']);

// Code → friendly value for the few enum columns we store.
const ENUM_LABELS: Record<string, Record<string, string>> = {
  service_type: {
    web_seo: 'Web SEO',
    local_seo: 'Local SEO',
    ai_seo: 'AI SEO',
    web_dev: 'Web Development',
    social_media: 'Social Media',
    hosting: 'Hosting',
    ads: 'Ads',
    maintenance: 'Support',
    franchise: 'Franchise',
    domains: 'Domains',
  },
  status: {
    active: 'Active',
    completed: 'Completed',
    done: 'Done',
    new: 'New',
    blocked: 'Blocked',
  },
  billing_type: {
    one_time: 'One-time',
    recurring_monthly: 'Monthly',
    recurring_yearly: 'Yearly',
  },
  payment_method: { cash: 'Cash', online: 'Online' },
};

export const FIELD_LABELS: Record<string, string> = {
  // identity / contact
  title: 'Title',
  name: 'Name',
  contact_first_name: 'Contact first name',
  contact_last_name: 'Contact last name',
  email: 'Email',
  phone: 'Phone',
  website: 'Website',
  company_name: 'Company',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  // location
  industry: 'Industry',
  country: 'Country',
  region: 'Region',
  city: 'City',
  address: 'Address',
  postcode: 'Postcode',
  vat_number: 'VAT number',
  // notes
  notes: 'Lead info',
  additional_notes: 'Notes',
  contact_info: 'Contact info',
  additional_contacts: 'Additional contacts',
  sales_note: 'Sales note',
  description: 'Description',
  details: 'Info',
  monthly_tasks: 'Checklist',
  // pipeline / ownership
  stage_id: 'Stage',
  accounting_stage_id: 'Accounting stage',
  owner_user_id: 'Owner',
  assigned_owner_id: 'Assigned owner',
  won_by_user_id: 'Won by',
  locked_by: 'Locked by',
  accounting_completed_by: 'Accounting completed by',
  blocked_by: 'Blocked by',
  status: 'Status',
  // money
  estimated_one_time_value: 'One-time value',
  estimated_monthly_value: 'Monthly value',
  estimated_total_value: 'Total value',
  one_time_value: 'One-time value',
  recurring_monthly_value: 'Monthly value',
  one_time_amount: 'One-time amount',
  monthly_amount: 'Monthly amount',
  setup_fee: 'Setup fee',
  amount_net: 'Net amount',
  temp_deal_amount: 'Deal amount',
  vat_rate: 'VAT rate',
  probability: 'Probability',
  currency: 'Currency',
  // dates
  expected_close_date: 'Expected close date',
  actual_close_date: 'Actual close date',
  start_date: 'Start date',
  recurring_start_date: 'Recurring start date',
  scheduled_for: 'Scheduled for',
  // services / billing
  services_planned: 'Services',
  service_type: 'Service',
  billing_type: 'Billing',
  billing_active: 'Billing active',
  billing_only: 'Billing only',
  is_custom: 'Custom job',
  // flags / source
  archived: 'Archived',
  archived_reason: 'Archive reason',
  is_blocked: 'Blocked',
  blocked_reason: 'Block reason',
  source: 'Source',
  lead_source: 'Lead source',
  payment_method: 'Payment method',
  email_opt_out: 'Email opt-out',
  automations_enabled: 'Automations',
  // comments
  body: 'Message',
  mentioned_user_ids: 'Mentions',
};

/** snake_case column → readable label, used when a field has no explicit label. */
export function labelFor(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field]!;
  const s = field.replace(/_id$/, '').replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function titleCaseValue(v: string): string {
  const s = v.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatMoney(value: unknown): string {
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  const body = Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2);
  return `€${body}`;
}

function formatDate(value: string, withTime: boolean): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function summarizeServices(arr: unknown[]): string {
  if (arr.length === 0) return '—';
  const names = arr.map((item) => {
    if (typeof item === 'string') return ENUM_LABELS.service_type![item] ?? titleCaseValue(item);
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const code = (o.service_type ?? o.service ?? o.type ?? o.name) as string | undefined;
      if (code) return ENUM_LABELS.service_type![code] ?? titleCaseValue(String(code));
    }
    return null;
  });
  const clean = names.filter((n): n is string => !!n);
  if (clean.length === 0) return `${arr.length} service${arr.length > 1 ? 's' : ''}`;
  return clean.join(', ');
}

/** Render a single value in plain English (no UUIDs / JSON / true-false / ISO). */
export function formatValue(value: unknown, field: string, resolver: Resolver): string {
  if (value === null || value === undefined || value === '') return '—';

  if (typeof value === 'boolean') return value ? 'Yes' : 'No';

  if (typeof value === 'string') {
    if (STAGE_FIELDS.has(field)) {
      const stage = resolver.stages.find((s) => s.id === value);
      if (stage) {
        const dn = stage.display_names as { en?: string; el?: string } | null;
        return dn?.[resolver.lang] ?? dn?.en ?? stage.code;
      }
    }
    if (USER_FIELDS.has(field)) {
      const user = resolver.users.find((u) => u.user_id === value);
      if (user) return user.full_name?.trim() || user.email;
      return 'Unknown user';
    }
    if (DATE_FIELDS.has(field)) return formatDate(value, false);
    if (DATETIME_FIELDS.has(field)) return formatDate(value, true);
    if (ENUM_LABELS[field]) return ENUM_LABELS[field]![value] ?? titleCaseValue(value);
    return value.length > 80 ? value.slice(0, 80) + '…' : value;
  }

  if (typeof value === 'number') {
    if (MONEY_FIELDS.has(field)) return formatMoney(value);
    return String(value);
  }

  if (Array.isArray(value)) {
    if (field === 'services_planned') return summarizeServices(value);
    if (value.length === 0) return '—';
    return `${value.length} item${value.length > 1 ? 's' : ''}`;
  }

  // Any other object (jsonb like details / monthly_tasks): never dump raw JSON.
  return 'updated';
}

export type Diff = { field: string; before: unknown; after: unknown };

export function diffOf(changes: unknown): Diff[] {
  if (!changes || typeof changes !== 'object') return [];
  const c = changes as { old?: Record<string, unknown>; new?: Record<string, unknown> };
  if (!c.old || !c.new) return [];
  const result: Diff[] = [];
  for (const key of Object.keys(c.new)) {
    if (HIDDEN_FIELDS.has(key)) continue;
    if (JSON.stringify(c.old[key]) !== JSON.stringify(c.new[key])) {
      result.push({ field: key, before: c.old[key], after: c.new[key] });
    }
  }
  return result;
}

export function snapshotFields(changes: unknown): { field: string; value: unknown }[] {
  if (!changes || typeof changes !== 'object') return [];
  const obj = changes as Record<string, unknown>;
  return Object.keys(obj)
    .filter((k) => !HIDDEN_FIELDS.has(k) && obj[k] !== null && obj[k] !== '')
    .map((k) => ({ field: k, value: obj[k] }));
}

/** Who performed the change: name → email → "Unknown user" → "System" (automated). */
export function describeActor(row: {
  user_id: string | null;
  user: { full_name?: string | null; email?: string | null } | null;
}): string {
  const name = row.user?.full_name?.trim();
  if (name) return name;
  const email = row.user?.email?.trim();
  if (email) return email;
  return row.user_id ? 'Unknown user' : 'System';
}

export type ActivityCategory =
  | 'payment' | 'job' | 'deal' | 'client' | 'attachment' | 'task' | 'email' | 'comment' | 'other';

const CATEGORY_BY_ENTITY: Record<string, ActivityCategory> = {
  deal_payments: 'payment',
  jobs: 'job',
  deals: 'deal',
  clients: 'client',
  attachments: 'attachment',
  user_tasks: 'task',
  assigned_tasks: 'task',
  email_log: 'email',
  comments: 'comment',
};

export function categoryOf(entityType: string): ActivityCategory {
  return CATEGORY_BY_ENTITY[entityType] ?? 'other';
}

export type EventView = {
  category: ActivityCategory;
  summary: string;
  lines: { key: string; label: string; text: string }[];
};

type RawEvent = { entity_type: string; action: 'insert' | 'update' | 'delete'; changes: unknown };

/** Current snapshot: flat object for insert/delete, the `new` side for update. */
function currentOf(changes: unknown): Record<string, unknown> {
  if (!changes || typeof changes !== 'object') return {};
  const c = changes as Record<string, unknown>;
  if (c.new && typeof c.new === 'object') return c.new as Record<string, unknown>;
  return c;
}
/** Previous snapshot: the `old` side for update, else empty. */
function previousOf(changes: unknown): Record<string, unknown> {
  if (!changes || typeof changes !== 'object') return {};
  const c = changes as Record<string, unknown>;
  if (c.old && typeof c.old === 'object') return c.old as Record<string, unknown>;
  return {};
}

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'pending', paid: 'paid', awaiting: 'awaiting', overdue: 'overdue', cancelled: 'cancelled',
};
function paymentStatus(s: unknown): string {
  const key = String(s ?? '');
  return PAYMENT_STATUS_LABELS[key] ?? key;
}
function paymentAmount(row: Record<string, unknown>): unknown {
  return row.amount_net ?? row.amount;
}

const EMAIL_TEMPLATE_LABELS: Record<string, string> = {
  won_welcome: 'Welcome email',
  lead_welcome: 'Lead welcome email',
  webseo_gsc_access: 'Web SEO – GSC access request',
  localseo_gbp_access: 'Local SEO – GBP access request',
  contract_send: 'Contract',
  payment_due_soon: 'Payment reminder',
  payment_overdue: 'Payment reminder',
  payment_reminder: 'Payment reminder',
  reengage_90d: 'Re-engagement email',
  noanswer_day0: 'No-answer follow-up', noanswer_day2: 'No-answer follow-up',
  noanswer_day5: 'No-answer follow-up', noanswer_day10: 'No-answer follow-up',
  offer_followup_day2: 'Offer follow-up', offer_followup_day5: 'Offer follow-up', offer_followup_day10: 'Offer follow-up',
  scheduled_confirm: 'Appointment confirmation',
  scheduled_reminder: 'Appointment reminder',
  scheduled_noshow: 'Appointment no-show follow-up',
  won_next_steps: 'Next-steps email',
  custom: 'Email',
};
export function emailTemplateLabel(key: string): string {
  if (EMAIL_TEMPLATE_LABELS[key]) return EMAIL_TEMPLATE_LABELS[key]!;
  const s = key.replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Email';
}

const NOUNS: Record<string, string> = { clients: 'client', deals: 'deal', jobs: 'job', leads: 'lead' };
function nounFor(entityType: string): string {
  return NOUNS[entityType] ?? entityType.replace(/s$/, '');
}

/** Turn one activity row into a feed entry: category + summary + detail lines. */
export function describeEvent(row: RawEvent, resolver: Resolver): EventView {
  const category = categoryOf(row.entity_type);
  const cur = currentOf(row.changes);
  const prev = previousOf(row.changes);

  if (category === 'payment') {
    const amount = formatMoney(paymentAmount(cur) ?? paymentAmount(prev));
    if (row.action === 'insert')
      return { category, summary: `Payment of ${amount} created (${paymentStatus(cur.status)})`, lines: [] };
    if (row.action === 'delete')
      return { category, summary: `Payment of ${amount} deleted`, lines: [] };
    const oldStatus = String(prev.status ?? '');
    const newStatus = String(cur.status ?? '');
    if (oldStatus !== newStatus) {
      if (newStatus === 'paid') return { category, summary: `Payment of ${amount} marked paid`, lines: [] };
      if (newStatus === 'pending') return { category, summary: `Payment of ${amount} set back to pending`, lines: [] };
      return { category, summary: `Payment of ${amount} set to ${paymentStatus(newStatus)}`, lines: [] };
    }
    if (JSON.stringify(paymentAmount(prev)) !== JSON.stringify(paymentAmount(cur)))
      return { category, summary: `Payment amount changed ${formatMoney(paymentAmount(prev))} → ${amount}`, lines: [] };
    return { category, summary: `Payment of ${amount} updated`, lines: [] };
  }

  if (category === 'task') {
    const title = String(cur.title ?? prev.title ?? 'task');
    if (row.action === 'insert') return { category, summary: `Task “${title}” created`, lines: [] };
    if (row.action === 'delete') return { category, summary: `Task “${title}” deleted`, lines: [] };
    const becameDone =
      (!prev.completed_at && !!cur.completed_at) ||
      (prev.status !== 'resolved' && cur.status === 'resolved');
    return { category, summary: becameDone ? `Task “${title}” completed` : `Task “${title}” updated`, lines: [] };
  }

  if (category === 'attachment') {
    const file = String(cur.file_name ?? prev.file_name ?? 'file');
    if (row.action === 'insert') return { category, summary: `Uploaded ${file}`, lines: [] };
    if (row.action === 'delete') return { category, summary: `Deleted ${file}`, lines: [] };
    if (!prev.archived && !!cur.archived) return { category, summary: `Removed ${file}`, lines: [] };
    return { category, summary: `Updated ${file}`, lines: [] };
  }

  if (category === 'email') {
    const tpl = emailTemplateLabel(String(cur.template_key ?? prev.template_key ?? ''));
    const to = String(cur.to_email ?? prev.to_email ?? '');
    const lines = to ? [{ key: 'to', label: 'To', text: to }] : [];
    const status = String(cur.status ?? '');
    if (row.action === 'insert')
      return { category, summary: status === 'failed' ? `Email failed: ${tpl}` : `Email sent: ${tpl}`, lines };
    if (status === 'delivered') return { category, summary: `Email delivered: ${tpl}`, lines };
    if (status === 'bounced') return { category, summary: `Email bounced: ${tpl}`, lines };
    if (status === 'complained') return { category, summary: `Spam complaint: ${tpl}`, lines };
    return { category, summary: `Email ${status}: ${tpl}`, lines };
  }

  // Generic: client / deal / job / lead / other — same rendering as ActivityPanel.
  const noun = nounFor(row.entity_type);
  if (row.action === 'insert') {
    const lines = snapshotFields(row.changes).slice(0, 6)
      .map((f) => ({ key: f.field, label: labelFor(f.field), text: formatValue(f.value, f.field, resolver) }))
      .filter((l) => l.text !== '—');
    return { category, summary: `Created the ${noun}`, lines };
  }
  if (row.action === 'delete') return { category, summary: `Deleted the ${noun}`, lines: [] };
  const diffs = diffOf(row.changes);
  if (diffs.length === 0) return { category, summary: `Saved the ${noun} (no changes)`, lines: [] };
  const lines = diffs.slice(0, 12).map((d) => ({
    key: d.field, label: labelFor(d.field),
    text: `${formatValue(d.before, d.field, resolver)} → ${formatValue(d.after, d.field, resolver)}`,
  }));
  return { category, summary: `Updated the ${noun}:`, lines };
}
