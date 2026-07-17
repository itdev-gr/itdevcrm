import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useLead } from '@/features/leads/hooks/useLead';
import { useOfferCatalog, type CatalogPackage } from '@/features/offers/hooks/useOfferCatalog';
import { useOffer } from '@/features/offers/hooks/useOffer';
import { useCreateProForma } from './hooks/useCreateProForma';
import { OfferSummaryPanel } from '@/features/offers/OfferSummaryPanel';
import { seedFromOffer } from '@/lib/proformas/fromOffer';
import type { OfferItem } from '@/lib/offers/types';
import { calculateTotals } from '@/lib/offers/calculate';
import { effectiveVatRate } from '@/lib/countries';

const lang: 'en' | 'el' = 'el';

const CATEGORY_LABELS: Record<string, { en: string; el: string }> = {
  web_seo: { en: 'Web SEO', el: 'Web SEO' },
  local_seo: { en: 'Local SEO', el: 'Local SEO' },
  web_dev: { en: 'Web Development', el: 'Ανάπτυξη Ιστοσελίδων' },
  social_media: { en: 'Social Media', el: 'Social Media' },
  ai_seo: { en: 'AI SEO', el: 'AI SEO' },
  hosting: { en: 'Hosting', el: 'Φιλοξενία' },
  ads: { en: 'Ads', el: 'Διαφημίσεις' },
  maintenance: { en: 'Support', el: 'Υποστήριξη' },
};

function categoryLabel(serviceType: string): string {
  return CATEGORY_LABELS[serviceType]?.[lang] ?? serviceType;
}

function getLabel(pkg: CatalogPackage): string {
  return pkg.display_names[lang] ?? pkg.display_names['en'] ?? pkg.code;
}

function getUnitPrice(pkg: CatalogPackage, customPrice: number): number {
  if (pkg.default_one_time_amount > 0) return pkg.default_one_time_amount;
  if (pkg.default_monthly_amount > 0) return pkg.default_monthly_amount;
  return customPrice;
}

export function ProFormaBuilderPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromOfferId = searchParams.get('fromOffer');

  const { data: lead, isLoading: leadLoading } = useLead(leadId ?? '');
  const { data: catalog = [], isLoading: catalogLoading } = useOfferCatalog();
  const sourceOffer = useOffer(fromOfferId ?? '');
  const create = useCreateProForma();

  // Group catalog by service_type
  const grouped = catalog.reduce<Record<string, CatalogPackage[]>>((acc, pkg) => {
    if (!acc[pkg.service_type]) acc[pkg.service_type] = [];
    acc[pkg.service_type]!.push(pkg);
    return acc;
  }, {});
  const categories = Object.keys(grouped);

  // ── Category / expansion state ──────────────────────────────────────────────
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Initialise category once catalog loads
   
  useEffect(() => {
    if (categories.length > 0 && !selectedCategory) {
      setSelectedCategory(categories[0] ?? '');
    }
  }, [categories.length, selectedCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Selection state ─────────────────────────────────────────────────────────
  const [selectedItems, setSelectedItems] = useState<Map<string, OfferItem>>(new Map());
  const [selectedSubpackages, setSelectedSubpackages] = useState<Map<string, Set<string>>>(
    new Map(),
  );
  const [customPriceByItem, setCustomPriceByItem] = useState<Record<string, number>>({});

  // ── Form state ──────────────────────────────────────────────────────────────
  const [currency, setCurrency] = useState('EUR');
  const [discountAmount, setDiscountAmount] = useState(0);
  const [vatPercent, setVatPercent] = useState(24);
  const [validityDays, setValidityDays] = useState(14);
  const [notes, setNotes] = useState('');

  // Pre-fill from lead once loaded. VAT defaults to whatever the lead's
  // country dictates — Greece 24%, Cyprus 0%, fallback 24%. The user can
  // still override the field manually.
  const vatSeededRef = useRef(false);

  useEffect(() => {
    if (!lead) return;
    if (!vatSeededRef.current) {
      const rate = effectiveVatRate(lead.payment_method, lead.country, lead.cash_charge_vat ?? false);
      setVatPercent(Math.round(rate * 100));
      vatSeededRef.current = true;
    }
  }, [lead]);

  // Pre-select catalog items based on what the lead's Services field already
  // has. Sales picked these on the lead form; the offer builder should open
  // with them already in the cart so they don't have to re-pick. One-shot via
  // a ref so subsequent realtime refreshes of the lead don't clobber edits.
  const seededRef = useRef(false);

  const fromOfferAppliedRef = useRef(false);

  // Arriving via "Create Pro Forma" on an offer: seed everything from that
  // offer — same items, same prices, same discount/VAT/currency/notes. This
  // wins over the lead-based seeding below (declared first so it runs first);
  // a missing or foreign offer falls back to the normal lead seeding.
  useEffect(() => {
    if (seededRef.current) return;
    if (!fromOfferId || catalog.length === 0 || sourceOffer.isLoading) return;
    const offer = sourceOffer.data;
    if (!offer || offer.lead_id !== leadId) return;

    const seed = seedFromOffer(offer, catalog);
    const nextItems = new Map<string, OfferItem>();
    for (const it of seed.items) nextItems.set(`${it.category}-${it.itemId}`, it);
    if (nextItems.size > 0) {
      setSelectedItems(nextItems);
      const firstCategory = seed.items[0]?.category;
      if (firstCategory) setSelectedCategory(firstCategory);
    }
    setCustomPriceByItem(seed.customPriceByItem);
    setCurrency(seed.currency);
    setDiscountAmount(seed.discountAmount);
    setVatPercent(seed.vatPercent);
    setValidityDays(seed.validityDays);
    setNotes(seed.notes);
    vatSeededRef.current = true; // offer VAT wins over the lead-country default
    fromOfferAppliedRef.current = true;
    seededRef.current = true;
  }, [fromOfferId, sourceOffer.isLoading, sourceOffer.data, catalog, leadId]);

  useEffect(() => {
    if (seededRef.current) return;
    if (!lead || catalog.length === 0) return;
    // A pending from-offer seed takes priority — wait for it to resolve.
    if (fromOfferId && sourceOffer.isLoading) return;
    if (fromOfferId && sourceOffer.data && sourceOffer.data.lead_id === leadId) return;
    const planned = Array.isArray(lead.services_planned)
      ? (lead.services_planned as unknown as Array<{
          service_type?: string;
          billing_type?: string;
          package_id?: string | null;
          monthly_amount?: number | string | null;
          one_time_amount?: number | string | null;
          subpackage_codes?: string[];
        }>)
      : [];
    if (planned.length === 0) {
      seededRef.current = true;
      return;
    }

    const nextItems = new Map<string, OfferItem>();
    const nextSubpackages = new Map<string, Set<string>>();
    for (const ps of planned) {
      // Match the lead's services_planned entry to a catalog row. Prefer the
      // explicit package_id; otherwise fall back to (service_type) only when
      // the service_type maps to exactly one catalog row.
      const pkg = ps.package_id
        ? catalog.find((p) => p.id === ps.package_id)
        : (() => {
            const pool = catalog.filter((p) => p.service_type === ps.service_type);
            return pool.length === 1 ? pool[0] : null;
          })();
      if (!pkg) continue;

      const userPrice =
        ps.billing_type === 'one_time'
          ? Number(ps.one_time_amount ?? 0)
          : Number(ps.monthly_amount ?? 0);
      const unitPrice =
        userPrice > 0 ? userPrice : getUnitPrice(pkg, 0);
      // Inline the same key shape used by itemKey() further below — declared
      // after this effect, so we can't call it here without re-ordering.
      const key = `${pkg.service_type}-${pkg.code}`;
      const subCodes = ps.subpackage_codes ?? [];
      const subTotal = subCodes.length > 0
        ? pkg.subpackages
            .filter((sp) => subCodes.includes(sp.code))
            .reduce((sum, sp) => sum + sp.price, 0)
        : 0;
      nextItems.set(key, {
        category: pkg.service_type,
        itemId: pkg.code,
        label: getLabel(pkg),
        description: pkg.description ?? '',
        unitPrice,
        qty: 1,
        lineTotal: unitPrice + subTotal,
      });
      if (subCodes.length > 0) {
        nextSubpackages.set(key, new Set(subCodes));
      }
    }

    if (nextItems.size > 0) {
      setSelectedItems(nextItems);
      if (nextSubpackages.size > 0) {
        setSelectedSubpackages(nextSubpackages);
      }
      // Land the user on the first pre-selected category for visual confirmation.
      const firstCategory = [...nextItems.values()][0]?.category;
      if (firstCategory) setSelectedCategory(firstCategory);
    }
    seededRef.current = true;
  }, [lead, catalog, fromOfferId, sourceOffer.isLoading, sourceOffer.data, leadId]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const itemKey = useCallback((serviceType: string, code: string) => `${serviceType}-${code}`, []);

  /** Recompute a selected item's lineTotal from its unit price + selected subpackage prices. */
  const recomputeLineTotal = useCallback(
    (
      _key: string,
      pkg: CatalogPackage,
      unitPrice: number,
      subSet: Set<string>,
    ): OfferItem | null => {
      const subTotal = pkg.subpackages
        .filter((sp) => subSet.has(sp.code))
        .reduce((sum, sp) => sum + sp.price, 0);
      return {
        category: pkg.service_type,
        itemId: pkg.code,
        label: getLabel(pkg),
        description: pkg.description ?? '',
        unitPrice,
        qty: 1,
        lineTotal: unitPrice + subTotal,
      };
    },
    [],
  );

  const toggleItemExpanded = (key: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleItemToggle = (pkg: CatalogPackage) => {
    const key = itemKey(pkg.service_type, pkg.code);
    setSelectedItems((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
        // Also clear subpackages
        setSelectedSubpackages((sp) => {
          const ns = new Map(sp);
          ns.delete(key);
          return ns;
        });
      } else {
        const unitPrice = getUnitPrice(pkg, customPriceByItem[key] ?? 0);
        const subSet = selectedSubpackages.get(key) ?? new Set<string>();
        const item = recomputeLineTotal(key, pkg, unitPrice, subSet);
        if (item) next.set(key, item);
      }
      return next;
    });
  };

  const handleSubpackageToggle = (pkg: CatalogPackage, subCode: string) => {
    const key = itemKey(pkg.service_type, pkg.code);
    setSelectedSubpackages((prev) => {
      const next = new Map(prev);
      const curSet = new Set(next.get(key) ?? []);
      if (curSet.has(subCode)) curSet.delete(subCode);
      else curSet.add(subCode);
      next.set(key, curSet);

      // Re-compute parent line total if selected
      setSelectedItems((si) => {
        if (!si.has(key)) return si;
        const siNext = new Map(si);
        const unitPrice = getUnitPrice(pkg, customPriceByItem[key] ?? 0);
        const item = recomputeLineTotal(key, pkg, unitPrice, curSet);
        if (item) siNext.set(key, item);
        return siNext;
      });

      return next;
    });
  };

  const handleCustomPriceChange = (pkg: CatalogPackage, value: number) => {
    const key = itemKey(pkg.service_type, pkg.code);
    setCustomPriceByItem((prev) => ({ ...prev, [key]: value }));

    setSelectedItems((si) => {
      if (!si.has(key)) return si;
      const siNext = new Map(si);
      const subSet = selectedSubpackages.get(key) ?? new Set<string>();
      const item = recomputeLineTotal(key, pkg, value, subSet);
      if (item) siNext.set(key, item);
      return siNext;
    });
  };

  const handleRemoveItem = (offerItem: OfferItem) => {
    const key = itemKey(offerItem.category, offerItem.itemId);
    setSelectedItems((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    setSelectedSubpackages((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedItems(new Map());
    setSelectedSubpackages(new Map());
    setCustomPriceByItem({});
  };

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function onSubmit() {
    if (selectedItems.size === 0) return;
    const items = [...selectedItems.values()];
    const totals = calculateTotals(items, discountAmount, vatPercent);
    try {
      const id = await create.mutateAsync({
        lead_id: leadId ?? null,
        client_id: lead?.converted_client_id ?? null,
        deal_id: lead?.converted_deal_id ?? null,
        source_offer_id: fromOfferAppliedRef.current ? fromOfferId : null,
        currency,
        discount_amount: discountAmount,
        vat_percent: vatPercent,
        validity_days: validityDays,
        notes: notes.trim() || null,
        items,
        totals,
      });
      navigate(`/proformas/${id}`);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const items = [...selectedItems.values()];
  const currentPkgs = selectedCategory ? (grouped[selectedCategory] ?? []) : [];

  const leadSubtitle = lead
    ? `${lead.code} — ${[lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(' ') || lead.company_name || ''}`
    : leadId ?? '';

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Create pro forma</h1>
          {leadSubtitle && (
            <p className="mt-0.5 text-sm text-muted-foreground">{leadSubtitle}</p>
          )}
        </div>
        <Button variant="outline" onClick={() => navigate(`/leads/${leadId}`)}>
          Cancel
        </Button>
      </div>

      {/* Category + Item picker */}
      {catalogLoading || leadLoading ? (
        <p className="text-sm text-muted-foreground">Loading catalog…</p>
      ) : (
        <div className="grid grid-cols-12 gap-6">
          {/* Left sidebar — categories */}
          <aside className="col-span-3">
            <Card>
              <CardHeader>
                <CardTitle>Categories</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <nav className="space-y-1">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                        selectedCategory === cat
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {categoryLabel(cat)}
                    </button>
                  ))}
                </nav>
              </CardContent>
            </Card>
          </aside>

          {/* Right panel — packages */}
          <div className="col-span-9 space-y-3">
            <h2 className="text-base font-semibold">{categoryLabel(selectedCategory)}</h2>
            {currentPkgs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No packages in this category.</p>
            ) : (
              currentPkgs.map((pkg) => {
                const key = itemKey(pkg.service_type, pkg.code);
                const isSelected = selectedItems.has(key);
                const isExpanded = expandedItems.has(key);
                const hasSubpkgs = pkg.subpackages.length > 0;
                const isCustomPrice =
                  pkg.default_one_time_amount === 0 && pkg.default_monthly_amount === 0;
                const subSet = selectedSubpackages.get(key) ?? new Set<string>();

                const displayUnitPrice = isCustomPrice
                  ? (customPriceByItem[key] ?? 0)
                  : getUnitPrice(pkg, 0);
                const subTotal = pkg.subpackages
                  .filter((sp) => subSet.has(sp.code))
                  .reduce((s, sp) => s + sp.price, 0);
                const totalPrice = displayUnitPrice + subTotal;

                return (
                  <div
                    key={pkg.id}
                    className="overflow-hidden rounded-lg border bg-card"
                  >
                    {/* Package row */}
                    <div className="flex items-start gap-3 p-4 hover:bg-muted/30">
                      <input
                        type="checkbox"
                        id={key}
                        checked={isSelected}
                        onChange={() => handleItemToggle(pkg)}
                        className="mt-1 h-4 w-4 accent-primary"
                      />
                      <label htmlFor={key} className="flex-1 cursor-pointer space-y-1">
                        <p className="text-sm font-medium">{getLabel(pkg)}</p>
                        {pkg.description && (
                          <p className="text-xs text-muted-foreground">{pkg.description}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          {isCustomPrice ? (
                            <div
                              className="flex items-center gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="text-xs text-muted-foreground">
                                Custom price (€):
                              </span>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={customPriceByItem[key] ?? ''}
                                onChange={(e) =>
                                  handleCustomPriceChange(pkg, parseFloat(e.target.value) || 0)
                                }
                                className="h-6 w-24 px-2 text-xs"
                              />
                            </div>
                          ) : (
                            <span className="text-xs font-semibold text-primary">
                              €{displayUnitPrice.toFixed(2)}
                            </span>
                          )}
                          {isSelected && subTotal > 0 && (
                            <>
                              <span className="text-xs text-muted-foreground">
                                + €{subTotal.toFixed(2)} extras
                              </span>
                              <span className="text-xs font-bold text-primary">
                                = €{totalPrice.toFixed(2)}
                              </span>
                            </>
                          )}
                        </div>
                      </label>
                      {hasSubpkgs && (
                        <button
                          type="button"
                          onClick={() => toggleItemExpanded(key)}
                          className="mt-1 text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={isExpanded ? 'Collapse' : 'Expand'}
                        >
                          <ChevronRight
                            className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                          />
                        </button>
                      )}
                    </div>

                    {/* Sub-packages */}
                    {isExpanded && hasSubpkgs && isSelected && (
                      <div className="border-t bg-muted/20 px-4 py-3">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">
                          Extra services:
                        </p>
                        <div className="space-y-1.5 pl-4">
                          {pkg.subpackages.map((sp) => {
                            const spChecked = subSet.has(sp.code);
                            const spId = `${key}-${sp.code}`;
                            return (
                              <label
                                key={sp.id}
                                htmlFor={spId}
                                className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-muted/50"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  id={spId}
                                  type="checkbox"
                                  checked={spChecked}
                                  onChange={() => handleSubpackageToggle(pkg, sp.code)}
                                  className="mt-0.5 h-3.5 w-3.5 accent-primary"
                                />
                                <div className="space-y-0.5">
                                  <p className="text-xs font-medium">
                                    {sp.display_names[lang] ?? sp.display_names['en'] ?? sp.code}
                                  </p>
                                  {sp.description && (
                                    <p className="text-xs text-muted-foreground">
                                      {sp.description}
                                    </p>
                                  )}
                                  <p className="text-xs font-semibold text-primary">
                                    +€{sp.price.toFixed(2)}
                                  </p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Offer details form */}
      <Card>
        <CardHeader>
          <CardTitle>Pro forma details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="currency">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="discount">Discount (€)</Label>
              <Input
                id="discount"
                type="number"
                min={0}
                step="0.01"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vat">VAT (%)</Label>
              <Input
                id="vat"
                type="number"
                min={0}
                max={100}
                value={vatPercent}
                onChange={(e) => setVatPercent(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="validity">Validity (days)</Label>
              <Input
                id="validity"
                type="number"
                min={1}
                value={validityDays}
                onChange={(e) => setValidityDays(parseInt(e.target.value) || 14)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Additional notes for the pro forma…"
            />
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold">Summary</h3>
        <OfferSummaryPanel
          items={items}
          discountAmount={discountAmount}
          vatPercent={vatPercent}
          onRemove={handleRemoveItem}
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 border-t pt-4">
        <Button
          variant="outline"
          disabled={selectedItems.size === 0}
          onClick={handleClearSelection}
        >
          Clear selection
        </Button>
        <Button
          disabled={create.isPending || selectedItems.size === 0}
          onClick={() => void onSubmit()}
        >
          {create.isPending ? 'Creating…' : 'Create pro forma'}
        </Button>
      </div>
    </div>
  );
}
