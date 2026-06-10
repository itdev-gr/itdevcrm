// Greek transactional templates + an editable `custom` passthrough.
// Each template returns { subject, html, text }. Keep `data` shapes documented here.

export type Rendered = { subject: string; html: string; text: string };

const APP_BASE = 'https://app.itdev.gr'; // deal/offer links; adjust if the prod URL differs.

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
  let footer = '';
  let footerText = '';
  const appUrl = Deno.env.get('APP_URL');
  if (row.client_facing && data.unsubscribe_token && data.lead_id && appUrl) {
    const url = `${appUrl}/api/unsubscribe?lead=${data.lead_id}&token=${data.unsubscribe_token}`;
    footer = `<p style="font-size:11px;color:#94a3b8;margin-top:16px">Αν δεν θέλετε να λαμβάνετε ενημερώσεις από εμάς, <a href="${url}" style="color:#94a3b8">πατήστε εδώ</a>.</p>`;
    footerText = `\n\nΑπεγγραφή: ${url}`;
  }
  const html = shell(
    `<p>${escapeHtml(bodyText).replace(/\n/g, '<br/>')}</p>${footer}`,
  );
  return { subject, html, text: bodyText + footerText };
}

export function renderTemplate(templateKey: string, data: Record<string, unknown>): Rendered {
  const fn = TEMPLATES[templateKey];
  if (!fn) throw new Error(`Unknown template: ${templateKey}`);
  return fn(data ?? {});
}
