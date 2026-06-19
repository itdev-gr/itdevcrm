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
