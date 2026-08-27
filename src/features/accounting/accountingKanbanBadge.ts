/**
 * Pure helper for the accounting Kanban card's Paid/Partial badge.
 *
 * Extracted from AccountingKanbanCard's paymentSummary(), which used to
 * count `paid` against the FULL (unfiltered) payments list — so a deal with
 * 2 paid + 1 cancelled period showed "Partial" instead of "Paid" (audit
 * B11/F28). A cancelled row was never going to be paid; it should not drag
 * the denominator down. Cancelled rows are excluded from both paid and
 * total here.
 *
 * Only three labels exist today (mirrors the card's existing
 * `payments.card_status.*` i18n keys exactly): 'pending' covers both "no
 * countable payments at all" and "some countable payments, none paid yet" —
 * the card has never distinguished those two cases.
 */
export type PaidBadgeLabel = 'pending' | 'partial' | 'paid';

export function paidBadge(payments: { status: string }[]): {
  paid: number;
  total: number;
  label: PaidBadgeLabel;
} {
  const countable = payments.filter((p) => p.status !== 'cancelled');
  const paid = countable.filter((p) => p.status === 'paid').length;
  const total = countable.length;
  const label: PaidBadgeLabel =
    total === 0 || paid === 0 ? 'pending' : paid === total ? 'paid' : 'partial';
  return { paid, total, label };
}
