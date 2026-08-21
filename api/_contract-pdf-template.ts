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
  .band-logo { width: 40px; height: 40px; border-radius: 50%; background: var(--teal);
               display: flex; align-items: center; justify-content: center;
               font-weight: 700; font-size: 15px; letter-spacing: .5px; }
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
    <div class="band-logo">IT</div>
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
