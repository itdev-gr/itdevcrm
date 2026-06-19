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
  full_name: ['name', 'full name', 'fullname', 'full_name', 'όνομα', 'ονοματεπώνυμο', 'ονοματεπωνυμο'],
  email: ['email', 'e-mail', 'mail', 'ηλεκτρονικό ταχυδρομείο', 'ηλεκτρονικο ταχυδρομειο'],
  phone: ['phone', 'phone number', 'tel', 'telephone', 'mobile', 'τηλέφωνο', 'τηλεφωνο', 'κινητό', 'κινητο'],
  company: ['company', 'company name', 'εταιρεία', 'εταιρεια', 'επιχείρηση', 'επιχειρηση'],
  website: ['website', 'site', 'url', 'web', 'ιστοσελίδα', 'ιστοσελιδα'],
  notes: ['notes', 'note', 'comments', 'σημειώσεις', 'σημειωσεις', 'σχόλια', 'σχολια'],
};

const MAX_ROWS = 2000;

const norm = (s: string): string => s.trim().toLowerCase();

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
        if (v) lead[field] = v;
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
