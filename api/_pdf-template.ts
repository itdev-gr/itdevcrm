// Self-contained HTML template for offer PDFs.
// No @/ aliases, no src/lib imports — must run in Vercel serverless context.
// Faithful port of Offer_system-main/src/lib/pdf-template.ts with CRM arg adaptations.

export type OfferItem = {
  category: string;
  itemId: string;
  label: string;
  description: string;
  unitPrice: number;
  qty: number;
  lineTotal: number;
};

export type OfferTotals = {
  subtotal: number;
  discountAmount: number;
  taxable: number;
  vatAmount: number;
  total: number;
};

type Args = {
  offerId: string;
  offerNumber: string | null;
  clientName: string;
  companyName: string | null;
  email: string | null;
  currency: string;
  vatPercent: number;
  validityDays: number;
  notes: string | null;
  items: OfferItem[];
  totals: OfferTotals;
  createdAt: string; // ISO timestamp
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string | null | undefined): string {
  if (s === null || s === undefined) return '';
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return String(s).replace(/[&<>"']/g, (m) => map[m]);
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

// Category code → human label mapping
const CATEGORY_LABELS: Record<string, string> = {
  web_seo: 'Web SEO',
  local_seo: 'Local SEO',
  web_dev: 'Web Development',
  social_media: 'Social Media',
  ai_seo: 'AI SEO',
  hosting: 'Hosting',
  ads: 'Ads',
};

function getCategoryLabel(code: string): string {
  return CATEGORY_LABELS[code] ?? code;
}

// Monthly suffix applies to these category codes (matching the source template's human-label logic)
const MONTHLY_CATEGORY_CODES = new Set(['local_seo', 'web_seo', 'ai_seo', 'social_media']);
const NON_MONTHLY_ITEM_IDS = new Set(['extra-video', 'extra-post', 'extra-hosting', 'extra-page']);

function isMonthlyItem(item: OfferItem): boolean {
  return MONTHLY_CATEGORY_CODES.has(item.category) && !NON_MONTHLY_ITEM_IDS.has(item.itemId);
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

export function renderOfferHtml(args: Args): string {
  const createdDate = new Date(args.createdAt);
  const validUntilDate = new Date(createdDate.getTime() + args.validityDays * 86400000);

  const createdStr = createdDate.toLocaleDateString('el-GR');
  const validUntilStr = validUntilDate.toLocaleDateString('el-GR');

  const displayNumber = args.offerNumber
    ? `Offer #${escapeHtml(args.offerNumber)}`
    : `Offer #${escapeHtml(args.offerId.slice(0, 8))}`;

  // Group items by category
  const itemsByCategory = args.items.reduce((acc: Record<string, OfferItem[]>, item) => {
    const key = item.category || 'other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const categorySections = Object.entries(itemsByCategory)
    .map(
      ([category, categoryItems]) => `
      <div class="accordion-item mb-3">
        <div class="accordion-header w-full bg-[#0b2f41] text-white px-4 py-3 flex items-center justify-between">
          <span class="font-medium">${escapeHtml(getCategoryLabel(category))}</span>
        </div>
        <div class="accordion-content border border-gray-200 border-t-0 bg-white">
          <ul class="p-4 space-y-2">
            ${categoryItems
              .map(
                (item) => `
              <li class="text-sm text-gray-700 list-disc list-inside">
                ${escapeHtml(item.label)}
                ${item.description ? `<span class="text-xs text-gray-500"> — ${escapeHtml(item.description)}</span>` : ''}
              </li>
            `
              )
              .join('')}
          </ul>
        </div>
      </div>
    `
    )
    .join('');

  const itemRows = args.items
    .map(
      (item) => `
      <tr>
        <td class="px-4 py-3 text-sm text-gray-900">${escapeHtml(getCategoryLabel(item.category))}</td>
        <td class="px-4 py-3">
          <p class="text-sm font-medium text-gray-900">${escapeHtml(item.label)}</p>
          ${item.description ? `<p class="text-xs text-gray-500">${escapeHtml(item.description)}</p>` : ''}
        </td>
        <td class="px-4 py-3 text-sm text-gray-900 text-right">${item.qty}</td>
        <td class="px-4 py-3 text-sm text-gray-900 text-right">${formatCurrency(item.unitPrice, args.currency)}${isMonthlyItem(item) ? ' / μήνα' : ''}</td>
        <td class="px-4 py-3 text-sm font-semibold text-gray-900 text-right">${formatCurrency(item.lineTotal, args.currency)}</td>
      </tr>
    `
    )
    .join('');

  const notesSection = args.notes
    ? `<section class="mb-10 bg-white rounded-xl p-6 shadow">
        <h2 class="text-xl font-bold text-gray-900 mb-4">Σημειώσεις</h2>
        <p class="text-sm text-gray-700">${escapeHtml(args.notes)}</p>
      </section>`
    : '';

  return `<!DOCTYPE html>
<html lang="el">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${displayNumber}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      @page {
        margin: 0;
      }
      body {
        margin: 0;
        padding: 0;
        background: #5aa9a5;
      }
      .print-page {
        background: #5aa9a5;
        padding: 2.5rem 1.5rem;
        width: 100%;
      }
      .accordion-content {
        display: block !important;
      }
    </style>
  </head>
  <body>
    <div class="print-page">
      <div class="max-w-5xl mx-auto">
        <!-- Hero Section -->
        <div class="bg-gradient-to-b from-[#118b8f] to-[#0f6f7c] rounded-2xl p-8 md:p-12 mb-10 text-white shadow-lg">
          <div class="flex flex-col gap-6">
            <div class="flex items-center justify-between gap-4 flex-wrap">
              <div class="flex items-center gap-3">
                <div class="h-10 w-10 rounded-full bg-white/15 text-white flex items-center justify-center font-bold">
                  IT
                </div>
                <div>
                  <p class="text-xs uppercase tracking-[0.2em] text-white/80">IT DEV</p>
                  <p class="text-xs text-white/70">Web & Digital Solutions</p>
                </div>
              </div>
              <div class="text-right text-xs text-white/70">
                ${displayNumber}
              </div>
            </div>

            <h1 class="text-2xl sm:text-3xl font-bold text-center tracking-wide">
              ΤΕΧΝΙΚΗ &amp; ΟΙΚΟΝΟΜΙΚΗ ΠΡΟΤΑΣΗ
            </h1>

            <div class="bg-white text-gray-900 rounded-2xl shadow-xl p-6 md:p-8 max-w-3xl mx-auto">
              <div class="bg-[#0b2f41] text-white rounded-t-2xl px-6 py-3 -mx-6 -mt-6 mb-6 text-center font-semibold">
                ${escapeHtml(args.clientName)}
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                <div>
                  <p class="text-xs uppercase text-gray-500">Prepared for</p>
                  <p class="font-semibold">${escapeHtml(args.clientName)}</p>
                  ${args.companyName ? `<p class="text-gray-600">${escapeHtml(args.companyName)}</p>` : ''}
                </div>
                <div>
                  <p class="text-xs uppercase text-gray-500">Client</p>
                  ${args.email ? `<p class="text-gray-700">${escapeHtml(args.email)}</p>` : ''}
                  <p class="text-gray-700">Πρόταση εκδόθηκε: ${createdStr}</p>
                  <p class="text-gray-700">Πρόταση ισχύει έως: ${validUntilStr}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Idea Section -->
        <section class="mb-10">
          <div class="relative overflow-hidden rounded-2xl bg-[#0b2f41] text-white shadow-lg">
            <div class="absolute inset-y-0 left-[48%] w-[140px] rotate-12 bg-[#3f8f8a]"></div>
            <div class="relative p-8 md:p-10">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
                <div>
                  <h2 class="text-3xl font-bold leading-tight mb-4">
                    Έχετε την ιδέα;
                    <br />
                    Εμείς την
                    <br />
                    υλοποιούμε.
                  </h2>
                </div>
                <div class="text-base leading-relaxed text-white/90">
                  Μια ολοκληρωμένη ομάδα από εξειδικευμένους συνεργάτες είναι δίπλα
                  σας κάθε στιγμή &amp; συνεργάζονται για το καλύτερο αποτέλεσμα.
                </div>
              </div>

              <div class="border-t border-white/20 pt-8">
                <h2 class="text-xl font-bold mb-4">Ποιοί είμαστε;</h2>
                <p class="text-sm mb-8 text-white/90">
                  Σας ευχαριστούμε για το ενδιαφέρον που εκδηλώσατε να συνεργαστείτε
                  μαζί μας. Στόχος μας είναι να παρέχουμε υπηρεσίες υψηλής ποιότητας,
                  με συνέπεια και έμφαση στην ταχύτητα, την ασφάλεια και τη
                  διαφορετικότητα.
                </p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div class="bg-[#5aa9a5] rounded-lg p-6 text-white">
                    <div class="mb-4">
                      <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/>
                        <circle cx="12" cy="12" r="6" stroke="currentColor" stroke-width="2" fill="white"/>
                      </svg>
                    </div>
                    <h3 class="text-lg font-bold mb-3">Our Mission</h3>
                    <p class="text-sm leading-relaxed">
                      Έχουμε αναπτύξει το δικό μας σύστημα διαχείρισης περιεχομένου (Content Management System), δίνοντας έμφαση στην ταχύτητα, την ασφάλεια, την διαφορετικότητα και την ευκολία στη χρήση.
                    </p>
                  </div>
                  <div class="bg-[#5aa9a5] rounded-lg p-6 text-white">
                    <div class="mb-4">
                      <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/>
                        <circle cx="12" cy="12" r="6" stroke="currentColor" stroke-width="2" fill="none"/>
                        <circle cx="12" cy="12" r="2" fill="white"/>
                      </svg>
                    </div>
                    <h3 class="text-lg font-bold mb-3">Our Vision</h3>
                    <p class="text-sm leading-relaxed">
                      Το CMS μας έχει αποτελέσει τη βάση για περισσότερες από 200 κατασκευές ιστοσελίδων και ηλεκτρονικών καταστημάτων σε Ελλάδα και εξωτερικό, πάντα με συνεχή εξέλιξη, ενσωματώνοντας τις πιο σύγχρονες τεχνολογίες και λειτουργίες.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Capabilities Section -->
        <section class="mb-10 bg-white rounded-xl p-6 shadow">
          <h2 class="text-xl font-bold text-gray-900 mb-4">Δυνατότητες - Υπηρεσίες</h2>
          <div class="space-y-3">
            ${categorySections}
          </div>
        </section>

        <!-- Financial Offer Section -->
        <section class="mb-10 bg-white rounded-xl p-6 shadow">
          <h2 class="text-xl font-bold text-gray-900 mb-4">Οικονομική προσφορά</h2>
          <div class="overflow-x-auto bg-white border border-gray-200 rounded-lg">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Κατηγορία</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Υπηρεσία</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Ποσότητα</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Τιμή</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Σύνολο</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                ${itemRows}
              </tbody>
            </table>
          </div>

          <div class="flex justify-end mt-4">
            <div class="w-64 space-y-2">
              <div class="flex justify-between text-sm">
                <span class="text-gray-600">Subtotal:</span>
                <span class="text-gray-900">${formatCurrency(args.totals.subtotal, args.currency)}</span>
              </div>
              ${args.totals.discountAmount > 0 ? `
              <div class="flex justify-between text-sm text-green-600">
                <span>Discount:</span>
                <span>-${formatCurrency(args.totals.discountAmount, args.currency)}</span>
              </div>
              ` : ''}
              <div class="flex justify-between text-sm">
                <span class="text-gray-600">Taxable:</span>
                <span class="text-gray-900">${formatCurrency(args.totals.taxable, args.currency)}</span>
              </div>
              ${args.vatPercent > 0 ? `
              <div class="flex justify-between text-sm">
                <span class="text-gray-600">VAT (${args.vatPercent}%):</span>
                <span class="text-gray-900">${formatCurrency(args.totals.vatAmount, args.currency)}</span>
              </div>
              ` : ''}
              <div class="flex justify-between text-lg font-bold border-t pt-2 text-[#0f6f7c]">
                <span>Total:</span>
                <span>${formatCurrency(args.totals.total, args.currency)}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- Notes Section (optional) -->
        ${notesSection}

        <!-- Payment Methods Section -->
        <section class="mb-10 bg-white rounded-xl p-6 shadow">
          <h2 class="text-xl font-bold text-gray-900 mb-4">Τρόποι πληρωμής &amp; συνεργασίας</h2>
          <p class="text-sm text-gray-600 mb-4">Όλα τα πακέτα μας είναι προπληρωμή, εκτός από την κατασκευή ιστοσελίδας.</p>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div class="border border-gray-200 rounded-lg p-4">
              <h3 class="text-sm font-semibold text-gray-900 mb-2">Κατασκευή ιστοσελίδας</h3>
              <p class="text-sm text-gray-600">
                50% προκαταβολή και 50% κατά την παράδοση του έργου.
              </p>
            </div>
            <div class="border border-gray-200 rounded-lg p-4">
              <h3 class="text-sm font-semibold text-gray-900 mb-2">Όλα τα άλλα πακέτα</h3>
              <p class="text-sm text-gray-600">
                Προπληρωμή.
              </p>
            </div>
          </div>
          <h3 class="text-base font-semibold text-gray-900 mb-3">Διαθέσιμοι τρόποι πληρωμής</h3>
          <div class="space-y-4 text-sm text-gray-700">
            <div class="border border-gray-200 rounded-lg p-4">
              <p class="font-semibold text-gray-900 mb-2">Τράπεζα Πειραιώς</p>
              <p>IBAN: GR31 0172 1470 0051 4711 0472 667</p>
              <p>SWIFT/BIC: PIRBGRAA</p>
              <p>Δικαιούχος: IT DEV E.E.</p>
              <p>Α.Φ.Μ.: 802223278</p>
              <p>Ποσό: (σύμφωνα με προσφορά)</p>
            </div>
            <div class="border border-gray-200 rounded-lg p-4">
              <p class="font-semibold text-gray-900 mb-2">Revolut Business</p>
              <p>IBAN: LT16 3250 0205 4385 1135</p>
              <p>SWIFT/BIC: REVOLT21</p>
              <p class="mt-2"><a href="https://checkout.revolut.com/pay/ff1305ff-1397-4331-b648-d6eb10c6727a" class="text-indigo-600 hover:underline" target="_blank" rel="noopener">Άμεσος σύνδεσμος πληρωμής Revolut</a></p>
            </div>
            <div class="border border-gray-200 rounded-lg p-4">
              <p class="font-semibold text-gray-900 mb-2">Viva Wallet</p>
              <p><a href="https://pay.vivawallet.com/it-dev" class="text-indigo-600 hover:underline" target="_blank" rel="noopener">Άμεσος σύνδεσμος πληρωμής Viva Wallet</a></p>
            </div>
          </div>
        </section>

      </div>
    </div>
  </body>
</html>`;
}
