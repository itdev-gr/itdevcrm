import { INDUSTRIES } from '@/lib/industries';

export type InfoFieldType = 'url' | 'text' | 'textarea' | 'password' | 'select';
export type InfoFieldOption = { value: string; labelEn: string; labelEl: string };
export type InfoField = {
  key: string;
  labelEn: string;
  labelEl: string;
  type: InfoFieldType;
  section?: string;
  sharedWithDeal?: boolean;
  options?: InfoFieldOption[];
};

const LOCAL: InfoField[] = [
  { key: 'profile_url', labelEn: 'Profile URL', labelEl: 'URL Προφίλ', type: 'url' },
  { key: 'business_profile', labelEn: 'Business profile', labelEl: 'Προφίλ επιχείρησης', type: 'text' },
  { key: 'local_report_url', labelEn: 'Report URL', labelEl: 'URL Report', type: 'url', sharedWithDeal: true },
  { key: 'local_notes', labelEn: 'Local SEO Notes', labelEl: 'Σημειώσεις Local SEO', type: 'textarea', sharedWithDeal: true },
];

const WEB_SEO: InfoField[] = [
  { key: 'website', labelEn: 'Website', labelEl: 'Ιστοσελίδα', type: 'url' },
  { key: 'website_username', labelEn: 'Website username', labelEl: 'Username ιστοσελίδας', type: 'text' },
  { key: 'website_password', labelEn: 'Website password', labelEl: 'Password ιστοσελίδας', type: 'password' },
  { key: 'website_path', labelEn: 'Website path', labelEl: 'Διαδρομή ιστοσελίδας', type: 'text' },
  { key: 'web_report_url', labelEn: 'Web SEO report URL', labelEl: 'URL Report Web SEO', type: 'url', sharedWithDeal: true },
  { key: 'seo_notes', labelEn: 'SEO Notes', labelEl: 'Σημειώσεις SEO', type: 'textarea', sharedWithDeal: true },
];

const INDUSTRY_OPTIONS: InfoFieldOption[] = INDUSTRIES.map((i) => ({
  value: i.code,
  labelEn: i.labels.en,
  labelEl: i.labels.el,
}));

const WEB_DEV: InfoField[] = [
  { key: 'website', labelEn: 'Website', labelEl: 'Ιστοσελίδα', type: 'url' },
  { key: 'industry', labelEn: 'Industry', labelEl: 'Κλάδος', type: 'select', options: INDUSTRY_OPTIONS },
  { key: 'webdev_notes', labelEn: 'Web Dev Notes', labelEl: 'Σημειώσεις Web Dev', type: 'textarea', sharedWithDeal: true },
  { key: 'hosting', labelEn: 'Hosting', labelEl: 'Hosting', type: 'text' },
  { key: 'supabase_name', labelEn: 'Supabase name', labelEl: 'Όνομα Supabase', type: 'text' },
  { key: 'temp_url', labelEn: 'Temp Website URL', labelEl: 'Προσωρινό URL', type: 'url' },
  { key: 'live_url', labelEn: 'Live Website URL', labelEl: 'Live URL', type: 'url' },
  { key: 'email', labelEn: 'Email', labelEl: 'Email', type: 'text' },
];

const ADS: InfoField[] = [
  { key: 'ads_notes', labelEn: 'Ads Notes', labelEl: 'Σημειώσεις Ads', type: 'textarea', sharedWithDeal: true },
];

const withSection = (fields: InfoField[], section: string): InfoField[] =>
  fields.map((f) => ({ ...f, section }));

export const SERVICE_INFO_FIELDS: Record<string, InfoField[] | undefined> & {
  local_seo: InfoField[];
  web_seo: InfoField[];
  ai_seo: InfoField[];
  web_dev: InfoField[];
  ads: InfoField[];
} = {
  local_seo: LOCAL,
  web_seo: WEB_SEO,
  ai_seo: [...withSection(LOCAL, 'Local SEO'), ...withSection(WEB_SEO, 'Web SEO')],
  web_dev: WEB_DEV,
  ads: ADS,
};

export function infoFieldsFor(serviceType: string): InfoField[] {
  return SERVICE_INFO_FIELDS[serviceType] ?? [];
}

export type SharedField = { key: string; label: string; type: InfoFieldType; value: string };

export function sharedDealFields(
  serviceType: string,
  details: Record<string, unknown> | null | undefined,
): SharedField[] {
  const d = details ?? {};
  const seen = new Set<string>();
  const out: SharedField[] = [];
  for (const f of infoFieldsFor(serviceType)) {
    if (!f.sharedWithDeal || seen.has(f.key)) continue;
    seen.add(f.key);
    const v = d[f.key];
    if (v == null || v === '') continue;
    out.push({ key: f.key, label: f.labelEn, type: f.type, value: String(v) });
  }
  return out;
}

/**
 * Option list for a `select` Info field: a leading blank (empty = clear), then
 * the field's options localized to `lang`, then a one-off "(legacy) <value>"
 * entry when the stored value isn't a known option (so an odd/legacy value is
 * never silently dropped — matches the fallback documented in industries.ts).
 */
export function selectOptions(
  field: InfoField,
  currentValue: string,
  lang: 'en' | 'el',
): { value: string; label: string }[] {
  const opts = (field.options ?? []).map((o) => ({
    value: o.value,
    label: lang === 'el' ? o.labelEl : o.labelEn,
  }));
  const out = [{ value: '', label: '—' }, ...opts];
  const cur = currentValue.trim();
  if (cur !== '' && !opts.some((o) => o.value === cur)) {
    out.push({ value: cur, label: `${cur} (legacy)` });
  }
  return out;
}
