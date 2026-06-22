// Parse an uploaded CSV/Excel file into lead rows for the intake queue.
// SheetJS reads both .csv and .xlsx; it is lazy-imported so it stays out of the
// main bundle. Header matching uses a fixed template with English + Greek aliases;
// unrecognised columns are preserved in source_data so nothing is lost.

export type ImportedLeadRow = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  website: string | null;
  notes: string | null;
  source_data: Record<string, unknown>;
};

type LeadField = Exclude<keyof ImportedLeadRow, 'source_data'>;

const FIELD_ALIASES: Record<LeadField, string[]> = {
  full_name: ['name', 'full name', 'fullname', 'όνομα', 'ονοματεπώνυμο', 'ονοματεπωνυμο'],
  email: ['email', 'e-mail', 'mail', 'ηλεκτρονικό ταχυδρομείο', 'ηλεκτρονικο ταχυδρομειο'],
  // incl. the Meta lead-form Greek label "αριθμός τηλεφώνου" (phone number) and the
  // website-form English field "work_phone_number" (underscores → spaces via norm()).
  phone: ['phone', 'phone number', 'tel', 'telephone', 'mobile', 'mobile number', 'work phone number', 'τηλέφωνο', 'τηλεφωνο', 'κινητό', 'κινητο', 'αριθμός τηλεφώνου', 'αριθμος τηλεφωνου'],
  // incl. the Meta lead-form Greek label "όνομα εταιρείας" (company name)
  company: ['company', 'company name', 'εταιρεία', 'εταιρεια', 'επιχείρηση', 'επιχειρηση', 'όνομα εταιρείας', 'ονομα εταιρειας'],
  website: ['website', 'site', 'url', 'web', 'ιστοσελίδα', 'ιστοσελιδα'],
  notes: ['notes', 'note', 'comments', 'σημειώσεις', 'σημειωσεις', 'σχόλια', 'σχολια'],
};

const MAX_ROWS = 2000;

// Lowercase, trim, and treat underscores as spaces + collapse runs of whitespace, so
// Meta/Excel headers like "αριθμός_τηλεφώνου" match the space-form aliases above.
const norm = (s: string): string => s.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');

// Meta → Excel values are prefixed (p: phone, l: lead id, etc.). Strip the phone prefix
// so the value lands as a clean number.
function cleanValue(field: LeadField, v: string): string {
  if (field === 'phone') return v.replace(/^p:\s*/i, '').trim();
  return v;
}

export function mapHeader(header: string): LeadField | null {
  const h = norm(header);
  for (const field of Object.keys(FIELD_ALIASES) as LeadField[]) {
    if (FIELD_ALIASES[field].includes(h)) return field;
  }
  return null;
}

export type MapResult = { rows: ImportedLeadRow[]; skipped: number; dropped: number };

export function mapRowsToLeads(raw: Record<string, unknown>[]): MapResult {
  const limited = raw.slice(0, MAX_ROWS);
  const dropped = Math.max(0, raw.length - MAX_ROWS);
  let skipped = 0;
  const rows: ImportedLeadRow[] = [];

  for (const r of limited) {
    const lead: ImportedLeadRow = {
      full_name: null,
      email: null,
      phone: null,
      company: null,
      website: null,
      notes: null,
      source_data: {},
    };
    for (const [key, val] of Object.entries(r)) {
      const v = val == null ? '' : String(val).trim();
      const field = mapHeader(key);
      if (field) {
        const cv = cleanValue(field, v);
        if (cv) lead[field] = cv;
      } else if (v) {
        lead.source_data[key] = v;
      }
    }
    if (!lead.full_name && !lead.email && !lead.phone) {
      skipped++;
      continue;
    }
    rows.push(lead);
  }

  return { rows, skipped, dropped };
}

export async function parseLeadFile(file: File): Promise<MapResult> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const first = wb.SheetNames[0];
  const sheet = first ? wb.Sheets[first] : undefined;
  if (!sheet) return { rows: [], skipped: 0, dropped: 0 };
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return mapRowsToLeads(raw);
}

export const IMPORT_TEMPLATE_HEADERS = ['Name', 'Email', 'Phone', 'Company', 'Website', 'Notes'];
