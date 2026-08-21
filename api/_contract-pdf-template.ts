// Self-contained HTML template for contract PDFs.
// No @/ aliases, no src/lib imports — must run in Vercel serverless context.
// Brand-aligned with the offer PDF (navy #0b2f41 / teal #118b8f) but minimal:
// white page, one accent band, typographic hierarchy from the body text's own
// `## Άρθρο N` headings, dotted fill-ins for ____ runs.

import {
  CONTRACT_PROVIDER_LINES,
  CONTRACT_PROVIDER_STAMP_DATA_URI,
  CONTRACT_PROVIDER_SIGNATURE_DATA_URI,
} from './_contract-provider.js';

// The CRM's round IT DEV logo (public/favicon.png), embedded like the
// provider stamp so the PDF needs no network fetch for brand assets.
const LOGO_DATA_URI =
  'data:image/png;base64,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';

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

/** Runs of 3+ underscores become styled fill-in blanks (call on escaped text). */
function styleFills(escaped: string): string {
  return escaped.replace(/_{3,}/g, (m) => `<span class="fill" style="min-width:${Math.min(m.length * 6, 320)}px"></span>`);
}

/**
 * Mini-renderer for the contract body (plain text, already snapshotted from a
 * template). Understands just enough structure to typeset professionally:
 *   `## X` / `# X` lines → section headings, `- `/`• ` runs → real lists,
 *   3+ underscores → dotted fill-in blanks, blank lines → paragraph breaks.
 * Every piece of user text is HTML-escaped before styling.
 */
export function renderBody(body: string): string {
  const out: string[] = [];
  let list: string[] | null = null;
  let para: string[] = [];

  function flushPara() {
    if (para.length > 0) {
      out.push(`<p>${para.map((l) => styleFills(escapeHtml(l))).join('<br/>')}</p>`);
      para = [];
    }
  }
  function flushList() {
    if (list) {
      out.push(`<ul>${list.map((l) => `<li>${styleFills(escapeHtml(l))}</li>`).join('')}</ul>`);
      list = null;
    }
  }

  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    const h2 = /^##\s+(.*)$/.exec(trimmed);
    const h1 = !h2 ? /^#\s+(.*)$/.exec(trimmed) : null;
    const li = /^[-•]\s+(.*)$/.exec(trimmed);

    if (trimmed === '') {
      flushList();
      flushPara();
    } else if (h2 || h1) {
      flushList();
      flushPara();
      const text = styleFills(escapeHtml((h2 ?? h1)![1]));
      out.push(h2 ? `<h3 class="sec">${text}</h3>` : `<h2 class="sec sec-lg">${text}</h2>`);
    } else if (li) {
      flushPara();
      if (!list) list = [];
      list.push(li[1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushList();
  flushPara();
  return out.join('\n');
}

/** Drop a leading body line that just repeats the contract title (template
 *  bodies often start with the title; the page already shows it as the H1). */
function stripLeadingTitle(body: string, title: string): string {
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i < lines.length && lines[i].trim().toLowerCase() === title.trim().toLowerCase()) {
    return lines.slice(i + 1).join('\n');
  }
  return body;
}

export function renderContractHtml(input: ContractPdfInput): string {
  const date = new Date(input.createdAt).toLocaleDateString('el-GR');
  const clientLines = [
    input.clientName,
    input.contactName,
    [input.email, input.phone].filter(Boolean).join(' · '),
    input.vatNumber ? `ΑΦΜ: ${input.vatNumber}` : null,
    input.address,
  ]
    .filter((l): l is string => !!l && l.trim() !== '')
    .map(escapeHtml);
  const clientHtml = clientLines.length
    ? `<div class="party-name">${clientLines[0]}</div>${clientLines.slice(1).join('<br/>')}`
    : '—';
  const providerHtml =
    `<div class="party-name">${escapeHtml(CONTRACT_PROVIDER_LINES[0])}</div>` +
    CONTRACT_PROVIDER_LINES.slice(1).map(escapeHtml).join('<br/>');

  return `<!doctype html><html lang="el"><head><meta charset="utf-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<style>
  :root { --navy: #0b2f41; --teal: #118b8f; --slate: #64748b; --line: #e2e8f0; --ink: #0f172a; }
  * { box-sizing: border-box; }
  body { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; color: var(--ink); margin: 0; background: #fff; }

  .band { background: var(--navy); color: #fff; padding: 26px 56px;
          display: flex; justify-content: space-between; align-items: center; }
  .band-brand { display: flex; align-items: center; gap: 12px; }
  .band-logo { width: 44px; height: 44px; border-radius: 50%; display: block; }
  .band-name { font-size: 15px; font-weight: 700; letter-spacing: 2px; }
  .band-sub { font-size: 9px; color: rgba(255,255,255,.65); letter-spacing: 1px; margin-top: 2px; }
  .band-meta { text-align: right; }
  .band-num { display: inline-block; font-family: 'SF Mono', Menlo, Consolas, monospace;
              font-size: 12px; background: rgba(255,255,255,.12); border-radius: 6px;
              padding: 4px 10px; letter-spacing: 1px; }
  .band-date { font-size: 10px; color: rgba(255,255,255,.65); margin-top: 6px; }
  .band-rule { height: 3px; background: var(--teal); }

  .page { padding: 40px 56px 32px; }

  .eyebrow { font-size: 10px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase;
             color: var(--teal); margin: 0 0 6px; }
  h1.title { font-size: 22px; font-weight: 700; color: var(--navy); margin: 0 0 32px; line-height: 1.3; }

  .parties { display: flex; gap: 20px; margin: 0 0 36px; font-size: 11.5px; line-height: 1.7; }
  .party { flex: 1; border: 1px solid var(--line); border-radius: 8px; padding: 14px 18px 16px;
           border-top-width: 3px; }
  .party.provider { border-top-color: var(--teal); }
  .party.client { border-top-color: var(--navy); }
  .party b.label { display: block; font-size: 9px; font-weight: 600; letter-spacing: 2px;
                   text-transform: uppercase; color: var(--slate); margin-bottom: 8px; }
  .party-name { font-weight: 600; color: var(--navy); margin-bottom: 2px; }

  .body { font-size: 12.5px; line-height: 1.75; }
  .body p { margin: 0 0 12px; text-align: justify; }
  .body ul { margin: 0 0 12px; padding-left: 20px; }
  .body li { margin: 3px 0; }
  .body .sec { font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;
               color: var(--teal); margin: 26px 0 10px; padding-bottom: 6px;
               border-bottom: 1px solid var(--line); }
  .body .sec-lg { font-size: 14px; letter-spacing: 1px; color: var(--navy); }
  .body .sec:first-child { margin-top: 0; }
  .fill { display: inline-block; border-bottom: 1px dotted var(--slate); height: 1em;
          vertical-align: baseline; }

  .sigs-wrap { background: #f8fafc; border: 1px solid var(--line); border-radius: 10px;
               padding: 24px 24px 20px; margin-top: 48px; }
  .sigs { display: flex; gap: 40px; font-size: 10.5px; }
  .sig-col { flex: 1; display: flex; flex-direction: column; min-height: 250px; }
  .sig-body { flex: 1; display: flex; flex-direction: column; justify-content: flex-end;
              gap: 14px; padding-bottom: 10px; }
  .provider-stamp { width: 100%; max-width: 440px; height: auto; object-fit: contain; align-self: flex-start; }
  .sig-image { height: 110px; width: auto; object-fit: contain; align-self: flex-start; margin-left: 8px; }
  .sig-line { border-top: 1px solid var(--navy); padding-top: 8px; text-align: center;
              font-weight: 600; color: var(--navy); }
  .sig-date { margin-top: 14px; color: var(--slate); text-align: center; }
  .sig-date .fill { min-width: 110px; }

  .foot { margin-top: 36px; border-top: 1px solid var(--line); padding-top: 12px;
          font-size: 9px; color: var(--slate); text-align: center; letter-spacing: .4px; }
</style></head><body>

<div class="band">
  <div class="band-brand">
    <img class="band-logo" src="${LOGO_DATA_URI}" alt="IT DEV"/>
    <div>
      <div class="band-name">IT DEV</div>
      <div class="band-sub">WEB &amp; DIGITAL SOLUTIONS</div>
    </div>
  </div>
  <div class="band-meta">
    ${input.contractNumber ? `<span class="band-num">${escapeHtml(input.contractNumber)}</span>` : ''}
    <div class="band-date">${escapeHtml(date)}</div>
  </div>
</div>
<div class="band-rule"></div>

<div class="page">
  <p class="eyebrow">Σύμβαση Συνεργασίας</p>
  <h1 class="title">${escapeHtml(input.title)}</h1>

  <div class="parties">
    <div class="party provider"><b class="label">Πάροχος / Provider</b>${providerHtml}</div>
    <div class="party client"><b class="label">Πελάτης / Client</b>${clientHtml}</div>
  </div>

  <div class="body">${renderBody(stripLeadingTitle(input.body, input.title))}</div>

  <div class="sigs-wrap">
    <div class="sigs">
      <div class="sig-col">
        <div class="sig-body">
          <img class="provider-stamp" src="${CONTRACT_PROVIDER_STAMP_DATA_URI}" alt="IT. DEV E.E."/>
          <img class="sig-image" src="${CONTRACT_PROVIDER_SIGNATURE_DATA_URI}" alt="Υπογραφή παρόχου"/>
        </div>
        <div class="sig-line">Για τον Πάροχο</div>
        <div class="sig-date">Ημερομηνία: <span class="fill"></span></div>
      </div>
      <div class="sig-col">
        <div class="sig-body"></div>
        <div class="sig-line">Για τον Πελάτη</div>
        <div class="sig-date">Ημερομηνία: <span class="fill"></span></div>
      </div>
    </div>
  </div>

  <div class="foot">IT. DEV E.E. · Άργους 139, Αθήνα 104 41 · ΑΦΜ 802228278 · Τηλ 210 9248828 · www.itdev.gr</div>
</div>

</body></html>`;
}
