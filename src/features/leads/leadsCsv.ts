export type CsvColumn<T> = { header: string; value: (row: T) => string };

function esc(s: string): string {
  const v = s ?? '';
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

export function leadsToCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => esc(c.header)).join(',');
  if (rows.length === 0) return head;
  const body = rows.map((r) => columns.map((c) => esc(c.value(r) ?? '')).join(',')).join('\n');
  return head + '\n' + body;
}
