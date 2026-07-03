// Self-contained HTML template for pro forma («ΠΡΟΤΙΜΟΛΟΓΙΟ») PDFs.
// No @/ aliases, no src/lib imports — must run in Vercel serverless context.
// Invoice-style sibling of _pdf-template.ts: same IT DEV branding, palette and
// payment details, WITHOUT the marketing sections (who-we-are / mission /
// services accordion). A pro forma is a payment document, not a proposal.

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
  proFormaId: string;
  proFormaNumber: string | null;
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

const MONTHLY_CATEGORY_CODES = new Set(['local_seo', 'web_seo', 'ai_seo', 'social_media']);
const NON_MONTHLY_ITEM_IDS = new Set(['extra-video', 'extra-post', 'extra-hosting', 'extra-page']);

function isMonthlyItem(item: OfferItem): boolean {
  return MONTHLY_CATEGORY_CODES.has(item.category) && !NON_MONTHLY_ITEM_IDS.has(item.itemId);
}

export function renderProFormaHtml(args: Args): string {
  const createdDate = new Date(args.createdAt);
  const validUntilDate = new Date(createdDate.getTime() + args.validityDays * 86400000);

  const createdStr = createdDate.toLocaleDateString('el-GR');
  const validUntilStr = validUntilDate.toLocaleDateString('el-GR');

  const numberStr = args.proFormaNumber ?? args.proFormaId.slice(0, 8);
  const displayNumber = escapeHtml(numberStr);

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
    <title>Pro Forma #${displayNumber}</title>
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
    </style>
  </head>
  <body>
    <div class="print-page">
      <div class="max-w-5xl mx-auto">
        <!-- Header -->
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
                Pro Forma #${displayNumber}
              </div>
            </div>

            <h1 class="text-2xl sm:text-3xl font-bold text-center tracking-wide">
              ΠΡΟΤΙΜΟΛΟΓΙΟ
            </h1>

            <div class="bg-white text-gray-900 rounded-2xl shadow-xl p-6 md:p-8 max-w-3xl mx-auto">
              <div class="bg-[#0b2f41] text-white rounded-t-2xl px-6 py-3 -mx-6 -mt-6 mb-6 text-center font-semibold">
                ${escapeHtml(args.clientName)}
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                <div>
                  <p class="text-xs uppercase text-gray-500">Στοιχεία εκδότη</p>
                  <p class="font-semibold">IT DEV E.E.</p>
                  <p class="text-gray-600">Web &amp; Digital Solutions</p>
                  <p class="text-gray-600">Α.Φ.Μ.: 802223278</p>
                </div>
                <div>
                  <p class="text-xs uppercase text-gray-500">Προς</p>
                  <p class="font-semibold">${escapeHtml(args.clientName)}</p>
                  ${args.companyName ? `<p class="text-gray-600">${escapeHtml(args.companyName)}</p>` : ''}
                  ${args.email ? `<p class="text-gray-700">${escapeHtml(args.email)}</p>` : ''}
                  <p class="text-gray-700">Ημερομηνία έκδοσης: ${createdStr}</p>
                  <p class="text-gray-700">Ισχύει έως: ${validUntilStr}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Items -->
        <section class="mb-10 bg-white rounded-xl p-6 shadow">
          <h2 class="text-xl font-bold text-gray-900 mb-4">Υπηρεσίες</h2>
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
                <span class="text-gray-600">Μερικό σύνολο:</span>
                <span class="text-gray-900">${formatCurrency(args.totals.subtotal, args.currency)}</span>
              </div>
              ${args.totals.discountAmount > 0 ? `
              <div class="flex justify-between text-sm text-green-600">
                <span>Έκπτωση:</span>
                <span>-${formatCurrency(args.totals.discountAmount, args.currency)}</span>
              </div>
              ` : ''}
              <div class="flex justify-between text-sm">
                <span class="text-gray-600">Φορολογητέο:</span>
                <span class="text-gray-900">${formatCurrency(args.totals.taxable, args.currency)}</span>
              </div>
              ${args.vatPercent > 0 ? `
              <div class="flex justify-between text-sm">
                <span class="text-gray-600">ΦΠΑ (${args.vatPercent}%):</span>
                <span class="text-gray-900">${formatCurrency(args.totals.vatAmount, args.currency)}</span>
              </div>
              ` : ''}
              <div class="flex justify-between text-lg font-bold border-t pt-2 text-[#0f6f7c]">
                <span>Σύνολο:</span>
                <span>${formatCurrency(args.totals.total, args.currency)}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- Notes (optional) -->
        ${notesSection}

        <!-- Payment Methods -->
        <section class="mb-10 bg-white rounded-xl p-6 shadow">
          <h2 class="text-xl font-bold text-gray-900 mb-4">Τρόποι πληρωμής</h2>
          <p class="text-sm text-gray-600 mb-4">Παρακαλούμε αναγράψτε τον αριθμό προτιμολογίου (${displayNumber}) στην αιτιολογία της πληρωμής.</p>
          <div class="space-y-4 text-sm text-gray-700">
            <div class="border border-gray-200 rounded-lg p-4">
              <p class="font-semibold text-gray-900 mb-2">Τράπεζα Πειραιώς</p>
              <p>IBAN: GR31 0172 1470 0051 4711 0472 667</p>
              <p>SWIFT/BIC: PIRBGRAA</p>
              <p>Δικαιούχος: IT DEV E.E.</p>
              <p>Α.Φ.Μ.: 802223278</p>
              <p>Ποσό: ${formatCurrency(args.totals.total, args.currency)}</p>
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

        <!-- Footer note -->
        <section class="mb-10 bg-white rounded-xl p-6 shadow">
          <p class="text-sm text-gray-600">Το παρόν προτιμολόγιο δεν αποτελεί φορολογικό παραστατικό.</p>
        </section>

      </div>
    </div>
  </body>
</html>`;
}
