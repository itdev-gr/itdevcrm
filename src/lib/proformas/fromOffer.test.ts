import { describe, it, expect } from 'vitest';
import { seedFromOffer } from './fromOffer';
import type { CatalogPackage } from '@/features/offers/hooks/useOfferCatalog';

const CATALOG: CatalogPackage[] = [
  {
    id: 'p1',
    service_type: 'web_seo',
    code: 'seo-basic',
    display_names: { en: 'SEO Basic', el: 'SEO Basic' },
    description: null,
    subtitle: null,
    default_one_time_amount: 0,
    default_monthly_amount: 300,
    setup_fee: 0,
    sort_order: 1,
    subpackages: [],
  },
  {
    id: 'p2',
    service_type: 'web_dev',
    code: 'custom-site',
    display_names: { en: 'Custom site', el: 'Custom site' },
    description: null,
    subtitle: null,
    default_one_time_amount: 0,
    default_monthly_amount: 0,
    setup_fee: 0,
    sort_order: 2,
    subpackages: [],
  },
];

const baseOffer = {
  lead_id: 'lead-1',
  currency: 'EUR',
  discount_amount: 50,
  vat_percent: 24,
  validity_days: 30,
  notes: 'special terms',
  items: [
    {
      category: 'web_seo',
      itemId: 'seo-basic',
      label: 'SEO Basic',
      description: 'monthly seo',
      unitPrice: 300,
      qty: 1,
      lineTotal: 380, // 300 + 80 of extra services folded into the line
    },
    {
      category: 'web_dev',
      itemId: 'custom-site',
      label: 'Custom site',
      description: '',
      unitPrice: 1500,
      qty: 1,
      lineTotal: 1500,
    },
  ],
};

describe('seedFromOffer', () => {
  it('copies items exactly as stored, preserving lineTotal extras', () => {
    const seed = seedFromOffer(baseOffer, CATALOG);
    expect(seed.items).toHaveLength(2);
    expect(seed.items[0]).toEqual(baseOffer.items[0]);
    expect(seed.items[1]!.lineTotal).toBe(1500);
  });

  it('copies discount, vat, currency, validity and notes', () => {
    const seed = seedFromOffer(baseOffer, CATALOG);
    expect(seed.discountAmount).toBe(50);
    expect(seed.vatPercent).toBe(24);
    expect(seed.currency).toBe('EUR');
    expect(seed.validityDays).toBe(30);
    expect(seed.notes).toBe('special terms');
  });

  it('seeds customPriceByItem only for custom-priced catalog packages', () => {
    const seed = seedFromOffer(baseOffer, CATALOG);
    // web_dev/custom-site has both catalog defaults 0 → custom-priced
    expect(seed.customPriceByItem['web_dev-custom-site']).toBe(1500);
    // web_seo/seo-basic has a monthly default → not custom-priced
    expect(seed.customPriceByItem['web_seo-seo-basic']).toBeUndefined();
  });

  it('coerces string numerics (Postgres numeric can arrive as string)', () => {
    const seed = seedFromOffer(
      { ...baseOffer, discount_amount: '50.00', vat_percent: '24.00' },
      CATALOG,
    );
    expect(seed.discountAmount).toBe(50);
    expect(seed.vatPercent).toBe(24);
  });

  it('handles malformed rows: non-array items, null notes, bad validity', () => {
    const seed = seedFromOffer(
      { ...baseOffer, items: null, notes: null, validity_days: 0 },
      CATALOG,
    );
    expect(seed.items).toEqual([]);
    expect(seed.notes).toBe('');
    expect(seed.validityDays).toBe(14);
  });

  it('does not crash when a catalog match is missing', () => {
    const seed = seedFromOffer(baseOffer, []);
    expect(seed.items).toHaveLength(2);
    expect(seed.customPriceByItem).toEqual({});
  });
});
