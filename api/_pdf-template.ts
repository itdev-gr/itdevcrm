// Self-contained HTML template for offer PDFs.
// No @/ aliases, no src/lib imports — must run in Vercel serverless context.

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
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const MONTHLY_CATEGORIES = new Set(['Local SEO', 'Web SEO', 'AI SEO', 'Social Media']);
const NON_MONTHLY_ITEM_IDS = new Set(['extra-video', 'extra-post', 'extra-hosting', 'extra-page']);

function isMonthlyItem(item: OfferItem): boolean {
  return MONTHLY_CATEGORIES.has(item.category) && !NON_MONTHLY_ITEM_IDS.has(item.itemId);
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

export function renderOfferHtml(args: Args): string {
  const createdDate = new Date(args.createdAt);
  const validUntilDate = new Date(createdDate.getTime() + args.validityDays * 24 * 60 * 60 * 1000);

  const displayNumber = args.offerNumber
    ? escapeHtml(args.offerNumber)
    : escapeHtml(args.offerId.slice(0, 8));

  const createdStr = formatDate(createdDate);
  const validUntilStr = formatDate(validUntilDate);

  // Build items rows
  const itemRows = args.items
    .map((item) => {
      const monthlySuffix = isMonthlyItem(item) ? ' / μήνα' : '';
      return `
        <tr>
          <td>${escapeHtml(item.category)}</td>
          <td>
            <strong>${escapeHtml(item.label)}</strong><br />
            <span style="color: #666; font-size: 10px;">${escapeHtml(item.description)}</span>
          </td>
          <td class="text-right">${item.qty}</td>
          <td class="text-right">${formatCurrency(item.unitPrice, args.currency)}${monthlySuffix}</td>
          <td class="text-right"><strong>${formatCurrency(item.lineTotal, args.currency)}</strong></td>
        </tr>`;
    })
    .join('\n');

  // Build totals block
  const discountRow =
    args.totals.discountAmount > 0
      ? `<div class="totals-row" style="color: #059669;">
          <span>Discount:</span>
          <span>-${formatCurrency(args.totals.discountAmount, args.currency)}</span>
        </div>`
      : '';

  const vatRow =
    args.vatPercent > 0
      ? `<div class="totals-row">
          <span>VAT (${args.vatPercent}%):</span>
          <span>${formatCurrency(args.totals.vatAmount, args.currency)}</span>
        </div>`
      : '';

  // Client info optional fields
  const companyLine = args.companyName
    ? `${escapeHtml(args.companyName)}<br />`
    : '';
  const emailLine = args.email ? `${escapeHtml(args.email)}<br />` : '';

  // Notes section
  const notesSection = args.notes
    ? `<div class="notes">
        <div class="section-title">Notes</div>
        <div class="section-content">${escapeHtml(args.notes)}</div>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Offer #${displayNumber}</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        font-size: 12px;
        line-height: 1.6;
        color: #333;
        padding: 40px;
      }
      .header {
        border-bottom: 2px solid #4f46e5;
        padding-bottom: 20px;
        margin-bottom: 30px;
      }
      .company-name {
        font-size: 24px;
        font-weight: bold;
        color: #4f46e5;
        margin-bottom: 5px;
      }
      .company-address {
        font-size: 10px;
        color: #666;
      }
      .offer-info {
        display: flex;
        justify-content: space-between;
        margin-bottom: 30px;
      }
      .client-info, .offer-details {
        flex: 1;
      }
      .section-title {
        font-size: 10px;
        font-weight: 600;
        color: #666;
        text-transform: uppercase;
        margin-bottom: 5px;
      }
      .section-content {
        font-size: 12px;
        color: #333;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 30px;
      }
      thead {
        background-color: #f3f4f6;
      }
      th {
        text-align: left;
        padding: 10px;
        font-size: 10px;
        font-weight: 600;
        color: #666;
        text-transform: uppercase;
        border-bottom: 2px solid #e5e7eb;
      }
      td {
        padding: 10px;
        font-size: 11px;
        border-bottom: 1px solid #e5e7eb;
      }
      .text-right {
        text-align: right;
      }
      .totals {
        margin-left: auto;
        width: 250px;
      }
      .totals-row {
        display: flex;
        justify-content: space-between;
        padding: 5px 0;
        font-size: 11px;
      }
      .totals-row.total {
        font-size: 14px;
        font-weight: bold;
        border-top: 2px solid #333;
        padding-top: 10px;
        margin-top: 10px;
      }
      .notes {
        margin-top: 30px;
        padding-top: 20px;
        border-top: 1px solid #e5e7eb;
      }
      .footer {
        margin-top: 40px;
        padding-top: 20px;
        border-top: 1px solid #e5e7eb;
        font-size: 10px;
        color: #666;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="company-name">Your Company Name</div>
      <div class="company-address">
        123 Business Street, City, Country<br />
        Email: info@company.com | Phone: +1 234 567 890
      </div>
    </div>

    <div class="offer-info">
      <div class="client-info">
        <div class="section-title">Client Information</div>
        <div class="section-content">
          <strong>${escapeHtml(args.clientName)}</strong><br />
          ${companyLine}
          ${emailLine}
        </div>
      </div>
      <div class="offer-details">
        <div class="section-title">Offer Details</div>
        <div class="section-content">
          <strong>Offer #:</strong> ${displayNumber}<br />
          <strong>Date:</strong> ${createdStr}<br />
          <strong>Valid Until:</strong> ${validUntilStr}<br />
          <strong>Validity:</strong> ${args.validityDays} days
        </div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Category</th>
          <th>Item</th>
          <th class="text-right">Qty</th>
          <th class="text-right">Unit Price</th>
          <th class="text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-row">
        <span>Subtotal:</span>
        <span>${formatCurrency(args.totals.subtotal, args.currency)}</span>
      </div>
      ${discountRow}
      <div class="totals-row">
        <span>Taxable:</span>
        <span>${formatCurrency(args.totals.taxable, args.currency)}</span>
      </div>
      ${vatRow}
      <div class="totals-row total">
        <span>Total:</span>
        <span>${formatCurrency(args.totals.total, args.currency)}</span>
      </div>
    </div>

    ${notesSection}

    <div class="footer">
      <p>This offer is valid until ${validUntilStr}</p>
      <p style="margin-top: 10px;">Thank you for your business!</p>
    </div>
  </body>
</html>`;
}
