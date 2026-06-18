import { Button } from '@/components/ui/button';
import type { OfferItem } from '@/lib/offers/types';
import { calculateTotals, formatEur } from '@/lib/offers/calculate';

type Props = {
  items: OfferItem[];
  discountAmount: number;
  vatPercent: number;
  onRemove: (item: OfferItem) => void;
};

export function OfferSummaryPanel({ items, discountAmount, vatPercent, onRemove }: Props) {
  const totals = calculateTotals(items, discountAmount, vatPercent);
  if (items.length === 0)
    return <p className="text-sm text-muted-foreground">No items selected yet.</p>;

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-normal">Service</th>
            <th className="px-3 py-2 font-normal">Description</th>
            <th className="px-3 py-2 font-normal text-right">Qty</th>
            <th className="px-3 py-2 font-normal text-right">Unit</th>
            <th className="px-3 py-2 font-normal text-right">Total</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={`${it.category}-${it.itemId}`} className="border-t">
              <td className="px-3 py-2">{it.label}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{it.description}</td>
              <td className="px-3 py-2 text-right">{it.qty}</td>
              <td className="px-3 py-2 text-right">{formatEur(it.unitPrice)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatEur(it.lineTotal)}</td>
              <td className="px-3 py-2">
                <Button size="sm" variant="link" onClick={() => onRemove(it)}>
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-muted text-xs">
          <tr>
            <td colSpan={4} className="px-3 py-2 text-right font-medium">Subtotal</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatEur(totals.subtotal)}</td>
            <td />
          </tr>
          {totals.discountAmount > 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-2 text-right">Discount</td>
              <td className="px-3 py-2 text-right tabular-nums">-{formatEur(totals.discountAmount)}</td>
              <td />
            </tr>
          )}
          {vatPercent > 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-2 text-right">VAT ({vatPercent}%)</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatEur(totals.vatAmount)}</td>
              <td />
            </tr>
          )}
          <tr className="border-t">
            <td colSpan={4} className="px-3 py-2 text-right font-bold">Total</td>
            <td className="px-3 py-2 text-right font-bold tabular-nums">{formatEur(totals.total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
