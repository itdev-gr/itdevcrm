// Splits a large import into RPC-sized batches. A spreadsheet can carry
// thousands of rows and one giant jsonb payload to audience_add_members
// would fail — chunking also lets the UI show per-batch progress.
export function chunkRows<T>(rows: T[], size: number): T[][] {
  if (size <= 0) return rows.length ? [rows] : [];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size));
  }
  return out;
}
