import type { DealPaymentRow } from './hooks/useDealPayments';

/**
 * Grouping of deal payments into month sections, shared by the PaymentsPanel
 * table and the overview's payment cards (JobsBillingPanel).
 *
 * A month is "settled" when it has no pending/overdue rows. Settled months that
 * are already over (strictly before the current month) move to the Past
 * payments archive; settled current/future months (e.g. prepaid ones) stay in
 * the active list as a collapsed row until the month actually passes. All of
 * this is derived from row status — there is no closed-month state in the DB,
 * so reverting a payment to pending reopens its month automatically.
 */

export const NO_PERIOD_KEY = 'none';

export type MonthGroup<T> = {
  /** 'YYYY-MM', or NO_PERIOD_KEY for rows without a date. */
  key: string;
  rows: T[];
  /** Sum of gross amounts, cancelled rows excluded. */
  gross: number;
  paidCount: number;
  /** Rows that count toward completion (everything except cancelled). */
  billableCount: number;
  /** True when any row is pending or overdue. */
  hasOpen: boolean;
  hasOverdue: boolean;
};

export type PaymentMonthGroup = MonthGroup<DealPaymentRow>;

/** How to read the grouping-relevant fields off a payment shape. */
type MonthReaders<T> = {
  date: (p: T) => string | null;
  gross: (p: T) => number;
  status: (p: T) => string;
};

export function monthKeyOfDate(date: string | null): string {
  return date ? date.slice(0, 7) : NO_PERIOD_KEY;
}

export function monthKeyOf(row: Pick<DealPaymentRow, 'start_date'>): string {
  return monthKeyOfDate(row.start_date);
}

export function currentMonthKey(today: Date = new Date()): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

export function formatMonthKey(key: string, locale: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y!, m! - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

export function rowGross(row: DealPaymentRow): number {
  if (row.amount_gross != null) return Number(row.amount_gross);
  // Same cents rounding as the DB generated column.
  return (
    Math.round((Number(row.amount_net) + (Number(row.amount_net) * Number(row.vat_rate)) / 100) * 100) /
    100
  );
}

export function groupByMonth<T>(
  payments: T[],
  read: MonthReaders<T>,
  todayKey: string = currentMonthKey(),
): { active: MonthGroup<T>[]; past: MonthGroup<T>[] } {
  const byKey = new Map<string, MonthGroup<T>>();
  for (const row of payments) {
    const key = monthKeyOfDate(read.date(row));
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        rows: [],
        gross: 0,
        paidCount: 0,
        billableCount: 0,
        hasOpen: false,
        hasOverdue: false,
      };
      byKey.set(key, group);
    }
    group.rows.push(row);
    const status = read.status(row);
    if (status !== 'cancelled') {
      group.gross = Math.round((group.gross + read.gross(row)) * 100) / 100;
      group.billableCount += 1;
    }
    if (status === 'paid') group.paidCount += 1;
    if (status === 'pending' || status === 'overdue') group.hasOpen = true;
    if (status === 'overdue') group.hasOverdue = true;
  }

  const active: MonthGroup<T>[] = [];
  const past: MonthGroup<T>[] = [];
  for (const group of byKey.values()) {
    if (!group.hasOpen && group.key !== NO_PERIOD_KEY && group.key < todayKey) past.push(group);
    else active.push(group);
  }

  // Active: oldest first so overdue months surface on top; no-period group last.
  active.sort((a, b) => {
    if (a.key === NO_PERIOD_KEY) return 1;
    if (b.key === NO_PERIOD_KEY) return -1;
    return a.key.localeCompare(b.key);
  });
  // Past archive: most recent month first.
  past.sort((a, b) => b.key.localeCompare(a.key));

  return { active, past };
}

export function groupPaymentsByMonth(
  payments: DealPaymentRow[],
  todayKey: string = currentMonthKey(),
): { active: PaymentMonthGroup[]; past: PaymentMonthGroup[] } {
  return groupByMonth(
    payments,
    { date: (row) => row.start_date, gross: rowGross, status: (row) => row.status },
    todayKey,
  );
}
