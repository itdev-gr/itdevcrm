import type { OfferItem } from '@/lib/offers/types';
import type { CatalogPackage } from '@/features/offers/hooks/useOfferCatalog';

export type ProFormaSeed = {
  items: OfferItem[];
  /** key = `${category}-${itemId}`, only for catalog packages priced 0/0 (custom). */
  customPriceByItem: Record<string, number>;
  discountAmount: number;
  vatPercent: number;
  currency: string;
  notes: string;
  validityDays: number;
};

export type SourceOffer = {
  lead_id: string | null;
  currency: string;
  discount_amount: number | string;
  vat_percent: number | string;
  validity_days: number;
  notes: string | null;
  items: unknown;
};

/**
 * Map an existing offer row to the pro-forma builder's initial state.
 * Prices are copied exactly as stored on the offer — including any extra
 * services already folded into lineTotal. The catalog is only consulted to
 * keep the "Custom price" input populated for custom-priced packages.
 */
export function seedFromOffer(offer: SourceOffer, catalog: CatalogPackage[]): ProFormaSeed {
  const rawItems = Array.isArray(offer.items) ? (offer.items as OfferItem[]) : [];
  const items: OfferItem[] = rawItems
    .filter((it) => !!it && typeof it === 'object')
    .map((it) => ({
      category: String(it.category ?? ''),
      itemId: String(it.itemId ?? ''),
      label: String(it.label ?? ''),
      description: String(it.description ?? ''),
      unitPrice: Number(it.unitPrice) || 0,
      qty: Number(it.qty) || 1,
      lineTotal: Number(it.lineTotal) || 0,
    }));

  const customPriceByItem: Record<string, number> = {};
  for (const it of items) {
    const pkg = catalog.find((p) => p.service_type === it.category && p.code === it.itemId);
    if (pkg && pkg.default_one_time_amount === 0 && pkg.default_monthly_amount === 0) {
      customPriceByItem[`${it.category}-${it.itemId}`] = it.unitPrice;
    }
  }

  return {
    items,
    customPriceByItem,
    discountAmount: Number(offer.discount_amount) || 0,
    vatPercent: Number(offer.vat_percent) || 0,
    currency: offer.currency || 'EUR',
    notes: offer.notes ?? '',
    validityDays: offer.validity_days >= 1 ? offer.validity_days : 14,
  };
}
