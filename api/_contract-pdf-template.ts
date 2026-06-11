// Self-contained HTML template for contract PDFs.
// No @/ aliases, no src/lib imports — must run in Vercel serverless context.

export type ContractPdfInput = {
  contractNumber: string | null;
  title: string;
  body: string;
  clientName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  vatNumber: string | null;
  address: string | null;
  createdAt: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderContractHtml(input: ContractPdfInput): string {
  const bodyHtml = escapeHtml(input.body).replace(/\n/g, '<br/>');
  const date = new Date(input.createdAt).toLocaleDateString('el-GR');
  const clientLines = [
    input.clientName,
    input.contactName,
    [input.email, input.phone].filter(Boolean).join(' · '),
    input.vatNumber ? `ΑΦΜ: ${input.vatNumber}` : null,
    input.address,
  ]
    .filter((l): l is string => !!l && l.trim() !== '')
    .map(escapeHtml)
    .join('<br/>');

  return `<!doctype html><html><head><meta charset="utf-8"/><style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #0f172a; margin: 0; }
  .page { padding: 48px 56px; }
  .head { display: flex; justify-content: space-between; align-items: baseline;
          border-bottom: 2px solid #0f172a; padding-bottom: 16px; }
  .brand { font-size: 22px; font-weight: 700; letter-spacing: 1px; }
  .num { font-size: 12px; color: #64748b; }
  h1 { font-size: 18px; margin: 28px 0 4px; }
  .meta { font-size: 11px; color: #64748b; margin-bottom: 24px; }
  .parties { display: flex; gap: 32px; margin: 24px 0; font-size: 12px; }
  .party { flex: 1; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 16px; }
  .party b { display: block; margin-bottom: 6px; font-size: 11px;
             text-transform: uppercase; color: #64748b; }
  .body { font-size: 13px; line-height: 1.7; }
  .sigs { display: flex; gap: 48px; margin-top: 64px; font-size: 12px; }
  .sig { flex: 1; border-top: 1px solid #0f172a; padding-top: 8px; text-align: center; }
  </style></head><body><div class="page">
  <div class="head"><div class="brand">ITDEV</div><div class="num">${escapeHtml(input.contractNumber ?? '')}</div></div>
  <h1>${escapeHtml(input.title)}</h1>
  <div class="meta">${escapeHtml(date)}</div>
  <div class="parties">
    <div class="party"><b>Πάροχος / Provider</b>ITDEV<br/>itdev.gr<br/>sales@itdev.gr</div>
    <div class="party"><b>Πελάτης / Client</b>${clientLines}</div>
  </div>
  <div class="body">${bodyHtml}</div>
  <div class="sigs"><div class="sig">Για τον Πάροχο</div><div class="sig">Για τον Πελάτη</div></div>
  </div></body></html>`;
}
