export type RangePreset =
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'last_year'
  | 'custom';

export type DateRange = { from: string; to: string };

export function formatIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function periodOf(iso: string): string {
  return iso.slice(0, 7);
}

export function rangeForPreset(preset: RangePreset, anchor: Date = new Date()): DateRange {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();
  if (preset === 'this_month') {
    const from = new Date(Date.UTC(y, m, 1));
    const to = new Date(Date.UTC(y, m + 1, 0));
    return { from: formatIsoDate(from), to: formatIsoDate(to) };
  }
  if (preset === 'last_month') {
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 0));
    return { from: formatIsoDate(from), to: formatIsoDate(to) };
  }
  if (preset === 'this_year') {
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  if (preset === 'last_year') {
    return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  }
  return { from: formatIsoDate(anchor), to: formatIsoDate(anchor) };
}
