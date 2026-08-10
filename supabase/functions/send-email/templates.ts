// Greek transactional templates + an editable `custom` passthrough.
// Each template returns { subject, html, text }. Keep `data` shapes documented here.

import { renderSignatureHtml, renderSignatureText } from '../_shared/signature.ts';

export type Rendered = { subject: string; html: string; text: string };

// Deal/offer links. Single source of truth = APP_URL secret; falls back to prod.
const APP_BASE = Deno.env.get('APP_URL') ?? 'https://www.itdevcrm.com';

export const LOGO_URL = `${APP_BASE}/email-assets/itdev-logo-round.png`;
const COMPANY_SIG_HTML = renderSignatureHtml(LOGO_URL);
const COMPANY_SIG_TEXT = renderSignatureText();

const SERVICE_LABELS_EL: Record<string, string> = {
  web_seo: 'Web SEO',
  local_seo: 'Τοπικό SEO',
  web_dev: 'Ανάπτυξη Ιστού',
  social_media: 'Social Media',
  ai_seo: 'AI SEO',
  hosting: 'Φιλοξενία',
  ads: 'Διαφημίσεις',
};

function shell(bodyHtml: string, sig = ''): string {
  const footer = sig !== '' ? sig : `<p style="font-size:12px;color:#64748b">ITDEV · itdev.gr</p>`;
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.6">
${bodyHtml}
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
${footer}
</div>`;
}

function eur(n: number): string {
  return `€${Number(n).toFixed(2)}`;
}

export const TEMPLATES: Record<string, (data: Record<string, unknown>) => Rendered> = {
  // Ad-hoc "Send email" dialog. The body is PLAIN TEXT supplied by a staff user,
  // so escape it (then linkify + newline→<br/>) — never render it as raw HTML.
  // Prefer the raw `text` field; fall back to stripping tags off any legacy `html`.
  custom: (d) => {
    const subject = String(d.subject ?? '').replace(/[\r\n]+/g, ' ');
    const raw =
      typeof d.text === 'string' && d.text.length > 0
        ? String(d.text)
        : String(d.html ?? '').replace(/<[^>]+>/g, '');
    const bodyHtml = linkify(escapeHtml(raw)).replace(/\n/g, '<br/>');
    return { subject, html: shell(bodyHtml, COMPANY_SIG_HTML), text: raw + '\n\n' + COMPANY_SIG_TEXT };
  },

  // One-off company announcements (holiday notices, wishes). Body is plain
  // text from staff — escaped like `custom`. Optional hero image on top; the
  // URL is code-supplied (email-assets), never free HTML, so it stays safe.
  company_announcement: (d) => {
    const subject = String(d.subject ?? '').replace(/[\r\n]+/g, ' ');
    const raw = String(d.text ?? '');
    const imgUrl = typeof d.image_url === 'string' && d.image_url.startsWith('https://') ? d.image_url : null;
    const img = imgUrl
      ? `<img src="${escapeHtml(imgUrl)}" alt="" width="560" style="width:100%;max-width:560px;height:auto;border-radius:8px;display:block;margin:0 auto 20px"/>`
      : '';
    const bodyHtml = linkify(escapeHtml(raw)).replace(/\n/g, '<br/>');
    return {
      subject,
      html: shell(`${img}<p>${bodyHtml}</p>`, COMPANY_SIG_HTML),
      text: raw + '\n\n' + COMPANY_SIG_TEXT,
    };
  },

  payment_due_soon: (d) => {
    const svc = escapeHtml(SERVICE_LABELS_EL[String(d.service_type)] ?? String(d.service_type ?? ''));
    const name = escapeHtml(String(d.client_name ?? ''));
    const due = escapeHtml(String(d.due_date ?? ''));
    const subject = `Υπενθύμιση πληρωμής — λήγει ${String(d.due_date ?? '')}`;
    const html = shell(
      `<p>Αγαπητέ/ή ${name},</p>
<p>Σας υπενθυμίζουμε ότι η πληρωμή για την υπηρεσία <b>${svc}</b> ύψους <b>${eur(Number(d.amount_gross))}</b> λήγει στις <b>${due}</b>.</p>
<p>Ευχαριστούμε για τη συνεργασία.</p>`,
      COMPANY_SIG_HTML,
    );
    return { subject, html, text: `Υπενθύμιση: πληρωμή ${eur(Number(d.amount_gross))} (${svc}) λήγει ${String(d.due_date ?? '')}.` };
  },

  payment_due_today: (d) => {
    const svc = escapeHtml(SERVICE_LABELS_EL[String(d.service_type)] ?? String(d.service_type ?? ''));
    const name = escapeHtml(String(d.client_name ?? ''));
    const due = escapeHtml(String(d.due_date ?? ''));
    const subject = `Η πληρωμή σας λήγει σήμερα`;
    const html = shell(
      `<p>Αγαπητέ/ή ${name},</p>
<p>Η πληρωμή για την υπηρεσία <b>${svc}</b> ύψους <b>${eur(Number(d.amount_gross))}</b> λήγει <b>σήμερα</b> (${due}).</p>`,
      COMPANY_SIG_HTML,
    );
    return { subject, html, text: `Η πληρωμή ${eur(Number(d.amount_gross))} (${svc}) λήγει σήμερα.` };
  },

  payment_overdue: (d) => {
    const svc = escapeHtml(SERVICE_LABELS_EL[String(d.service_type)] ?? String(d.service_type ?? ''));
    const name = escapeHtml(String(d.client_name ?? ''));
    const due = escapeHtml(String(d.due_date ?? ''));
    const subject = `Εκπρόθεσμη πληρωμή`;
    const html = shell(
      `<p>Αγαπητέ/ή ${name},</p>
<p>Η πληρωμή για την υπηρεσία <b>${svc}</b> ύψους <b>${eur(Number(d.amount_gross))}</b> με λήξη στις <b>${due}</b> παραμένει εκκρεμής.</p>
<p>Παρακαλούμε επικοινωνήστε μαζί μας στο accounting@itdev.gr.</p>`,
      COMPANY_SIG_HTML,
    );
    return { subject, html, text: `Εκπρόθεσμη πληρωμή ${eur(Number(d.amount_gross))} (${svc}), λήξη ${String(d.due_date ?? '')}.` };
  },

  internal_new_task: (d) => {
    // Link target = the /tasks dialog (every staff user can reach it),
    // NOT the deal/job behind the task (RLS often hides those from the
    // service-team assignee). Mirrors readPath() in the in-app bell.
    const taskId = String(d.task_id ?? '');
    const kind = String(d.kind ?? 'assigned') === 'user' ? 'user' : 'assigned';
    const link = taskId
      ? `${APP_BASE}/tasks?open=${kind}:${encodeURIComponent(taskId)}`
      : `${APP_BASE}/tasks`;
    const title = escapeHtml(String(d.title ?? ''));
    const subject = `Νέα εργασία: ${String(d.title ?? '')}`;
    const html = shell(
      `<p>Σου ανατέθηκε νέα εργασία: <b>${title}</b>.</p>
<p><a href="${link}">Άνοιγμα στο CRM</a></p>`,
    );
    return { subject, html, text: `Νέα εργασία: ${String(d.title ?? '')} — ${link}` };
  },

  internal_new_job: (d) => {
    const link = `${APP_BASE}/deals/${encodeURIComponent(String(d.deal_id ?? ''))}`;
    const svc = escapeHtml(SERVICE_LABELS_EL[String(d.service_type)] ?? String(d.service_type ?? ''));
    const name = escapeHtml(String(d.client_name ?? ''));
    const subject = `Νέο job: ${SERVICE_LABELS_EL[String(d.service_type)] ?? String(d.service_type ?? '')}`;
    const html = shell(
      `<p>Δημιουργήθηκε νέο job <b>${svc}</b> για τον πελάτη <b>${name}</b>.</p>
<p><a href="${link}">Άνοιγμα στο CRM</a></p>`,
    );
    return { subject, html, text: `Νέο job ${svc} για ${name} — ${link}` };
  },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Turn bare http(s) URLs in already-escaped body text into clickable links.
// Runs before newline→<br/> conversion, so URLs end at whitespace/newline.
function linkify(escaped: string): string {
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#2563eb;text-decoration:underline">$1</a>',
  );
}

function interpolate(tpl: string, data: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => String(data[key] ?? ''));
}

// Subject-line safety net for the "{{code}} - real subject" pattern used by
// every client-facing template. When an enqueuer forgets to pass {{code}},
// `interpolate()` leaves a leading " - " behind that ships to the inbox
// (the nikkas1@ webseo_gsc_access / localseo_gbp_access incident, 2026-06-30).
// Strip a single leading "- " (with surrounding whitespace) and collapse
// double spaces so the subject still reads cleanly. Safe to apply to every
// rendered subject — a legitimate subject won't start with "-".
function cleanSubject(s: string): string {
  return s.replace(/^\s*-\s*/, '').replace(/\s{2,}/g, ' ').trim();
}

type DbTemplateRow = { subject: string; body: string; client_facing: boolean };

/**
 * Render from the admin-editable email_templates table; built-ins above are
 * the fallback for keys without a row (e.g. `custom`, internal_*). Lead
 * emails carrying an unsubscribe token get the opt-out footer required for
 * automated outreach.
 */
export function renderDbTemplate(
  row: DbTemplateRow,
  data: Record<string, unknown>,
): Rendered {
  const subject = cleanSubject(interpolate(row.subject, data));
  const bodyText = interpolate(row.body, data);
  // Unsubscribe opt-out footer removed per product decision (2026-06-24): no
  // emails carry the "…πατήστε εδώ" line anymore.
  const footer = '';
  const footerText = '';
  // Transactional emails (e.g. password reset) pass cta_url/cta_label to get
  // a styled action button under the body text. Text version is unchanged —
  // bodies that need a plain link carry it via a {{variable}}.
  let cta = '';
  if (data.cta_url) {
    const url = escapeHtml(String(data.cta_url));
    const label = escapeHtml(String(data.cta_label ?? 'Άνοιγμα / Open'));
    cta = `<p style="margin:24px 0"><a href="${url}" style="background:#0f172a;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${label}</a></p>`;
  }
  const sig = row.client_facing !== false ? COMPANY_SIG_HTML : '';
  const html = shell(
    `<p>${linkify(escapeHtml(bodyText)).replace(/\n/g, '<br/>')}</p>${cta}${footer}`,
    sig,
  );
  return {
    subject,
    html,
    text: sig !== '' ? `${bodyText}\n\n${COMPANY_SIG_TEXT}` : bodyText + footerText,
  };
}

export function renderTemplate(templateKey: string, data: Record<string, unknown>): Rendered {
  const fn = TEMPLATES[templateKey];
  if (!fn) throw new Error(`Unknown template: ${templateKey}`);
  return fn(data ?? {});
}
