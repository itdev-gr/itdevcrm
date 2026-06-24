// Greek transactional templates + an editable `custom` passthrough.
// Each template returns { subject, html, text }. Keep `data` shapes documented here.

export type Rendered = { subject: string; html: string; text: string };

// Deal/offer links. Single source of truth = APP_URL secret; falls back to prod.
const APP_BASE = Deno.env.get('APP_URL') ?? 'https://www.itdevcrm.com';

const SERVICE_LABELS_EL: Record<string, string> = {
  web_seo: 'Web SEO',
  local_seo: 'Τοπικό SEO',
  web_dev: 'Ανάπτυξη Ιστού',
  social_media: 'Social Media',
  ai_seo: 'AI SEO',
  hosting: 'Φιλοξενία',
  ads: 'Διαφημίσεις',
};

function shell(bodyHtml: string): string {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.6">
${bodyHtml}
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
<p style="font-size:12px;color:#64748b">ITDEV · itdev.gr</p>
</div>`;
}

function eur(n: number): string {
  return `€${Number(n).toFixed(2)}`;
}

export const TEMPLATES: Record<string, (data: Record<string, unknown>) => Rendered> = {
  // Editable one-click emails pass their own subject/html/text.
  custom: (d) => ({
    subject: String(d.subject ?? ''),
    html: shell(String(d.html ?? '')),
    text: String(d.text ?? String(d.html ?? '').replace(/<[^>]+>/g, '')),
  }),

  payment_due_soon: (d) => {
    const svc = SERVICE_LABELS_EL[String(d.service_type)] ?? String(d.service_type ?? '');
    const subject = `Υπενθύμιση πληρωμής — λήγει ${d.due_date}`;
    const html = shell(
      `<p>Αγαπητέ/ή ${d.client_name},</p>
<p>Σας υπενθυμίζουμε ότι η πληρωμή για την υπηρεσία <b>${svc}</b> ύψους <b>${eur(Number(d.amount_gross))}</b> λήγει στις <b>${d.due_date}</b>.</p>
<p>Ευχαριστούμε για τη συνεργασία.</p>`,
    );
    return { subject, html, text: `Υπενθύμιση: πληρωμή ${eur(Number(d.amount_gross))} (${svc}) λήγει ${d.due_date}.` };
  },

  payment_due_today: (d) => {
    const svc = SERVICE_LABELS_EL[String(d.service_type)] ?? String(d.service_type ?? '');
    const subject = `Η πληρωμή σας λήγει σήμερα`;
    const html = shell(
      `<p>Αγαπητέ/ή ${d.client_name},</p>
<p>Η πληρωμή για την υπηρεσία <b>${svc}</b> ύψους <b>${eur(Number(d.amount_gross))}</b> λήγει <b>σήμερα</b> (${d.due_date}).</p>`,
    );
    return { subject, html, text: `Η πληρωμή ${eur(Number(d.amount_gross))} (${svc}) λήγει σήμερα.` };
  },

  payment_overdue: (d) => {
    const svc = SERVICE_LABELS_EL[String(d.service_type)] ?? String(d.service_type ?? '');
    const subject = `Εκπρόθεσμη πληρωμή`;
    const html = shell(
      `<p>Αγαπητέ/ή ${d.client_name},</p>
<p>Η πληρωμή για την υπηρεσία <b>${svc}</b> ύψους <b>${eur(Number(d.amount_gross))}</b> με λήξη στις <b>${d.due_date}</b> παραμένει εκκρεμής.</p>
<p>Παρακαλούμε επικοινωνήστε μαζί μας στο accounting@itdev.gr.</p>`,
    );
    return { subject, html, text: `Εκπρόθεσμη πληρωμή ${eur(Number(d.amount_gross))} (${svc}), λήξη ${d.due_date}.` };
  },

  internal_new_task: (d) => {
    const link = `${APP_BASE}/deals/${d.deal_id ?? ''}`;
    const subject = `Νέα εργασία: ${d.title}`;
    const html = shell(
      `<p>Σου ανατέθηκε νέα εργασία: <b>${d.title}</b>.</p>
<p><a href="${link}">Άνοιγμα στο CRM</a></p>`,
    );
    return { subject, html, text: `Νέα εργασία: ${d.title} — ${link}` };
  },

  internal_new_job: (d) => {
    const link = `${APP_BASE}/deals/${d.deal_id ?? ''}`;
    const svc = SERVICE_LABELS_EL[String(d.service_type)] ?? String(d.service_type ?? '');
    const subject = `Νέο job: ${svc}`;
    const html = shell(
      `<p>Δημιουργήθηκε νέο job <b>${svc}</b> για τον πελάτη <b>${d.client_name}</b>.</p>
<p><a href="${link}">Άνοιγμα στο CRM</a></p>`,
    );
    return { subject, html, text: `Νέο job ${svc} για ${d.client_name} — ${link}` };
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
  const subject = interpolate(row.subject, data);
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
  const html = shell(
    `<p>${linkify(escapeHtml(bodyText)).replace(/\n/g, '<br/>')}</p>${cta}${footer}`,
  );
  return { subject, html, text: bodyText + footerText };
}

export function renderTemplate(templateKey: string, data: Record<string, unknown>): Rendered {
  const fn = TEMPLATES[templateKey];
  if (!fn) throw new Error(`Unknown template: ${templateKey}`);
  return fn(data ?? {});
}
