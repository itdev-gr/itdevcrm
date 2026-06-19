// Self-contained HTML template for contract PDFs.
// No @/ aliases, no src/lib imports — must run in Vercel serverless context.

import {
  CONTRACT_PROVIDER_STAMP_DATA_URI,
  CONTRACT_PROVIDER_SIGNATURE_DATA_URI,
} from './_contract-provider.js';

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

  return `<!doctype html><html lang="el"><head><meta charset="utf-8"/><style>
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
  .body { font-size: 13px; line-height: 1.7; overflow-wrap: break-word; }
  .sigs { display: flex; gap: 48px; margin-top: 64px; font-size: 11px; }
  .sig-col { flex: 1; display: flex; flex-direction: column; min-height: 220px; }
  .sig-body { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; gap: 12px; padding-bottom: 8px; }
  .provider-stamp { width: 100%; max-width: 340px; height: auto; object-fit: contain; align-self: flex-start; }
  .party-stamp { width: 100%; max-width: 280px; height: auto; object-fit: contain; display: block; margin-top: 4px; }
  .sig-image { height: 110px; width: auto; object-fit: contain; align-self: flex-start; }
  .sig-line { border-top: 1px solid #0f172a; padding-top: 8px; text-align: center; }
  </style></head><body><div class="page">
  <div class="head"><div class="brand">ITDEV</div><div class="num">${escapeHtml(input.contractNumber)}</div></div>
  <h1>${escapeHtml(input.title)}</h1>
  <div class="meta">${escapeHtml(date)}</div>
  <div class="parties">
    <div class="party"><b>Πάροχος / Provider</b><img class="party-stamp" src="${CONTRACT_PROVIDER_STAMP_DATA_URI}" alt="IT. DEV E.E."/></div>
    <div class="party"><b>Πελάτης / Client</b>${clientLines}</div>
  </div>
  <div class="body">${bodyHtml}</div>
  <div class="sigs">
    <div class="sig-col">
      <div class="sig-body">
        <img class="provider-stamp" src="${CONTRACT_PROVIDER_STAMP_DATA_URI}" alt="IT. DEV E.E."/>
        <img class="sig-image" src="${CONTRACT_PROVIDER_SIGNATURE_DATA_URI}" alt="Υπογραφή παρόχου"/>
      </div>
      <div class="sig-line">Για τον Πάροχο</div>
    </div>
    <div class="sig-col">
      <div class="sig-body"></div>
      <div class="sig-line">Για τον Πελάτη</div>
    </div>
  </div>
  </div></body></html>`;
}
