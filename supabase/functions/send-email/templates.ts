// Greek transactional templates + an editable `custom` passthrough.
// Each template returns { subject, html, text }. Keep `data` shapes documented here.

import { renderSignatureHtml, renderSignatureText } from '../_shared/signature.ts';
import { renderEmailMarkup } from '../_shared/emailMarkup.ts';

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

const CHATGPT_ADS_HERO = `${APP_BASE}/email-assets/chatgpt-ads-2026.jpg`;
const CHATGPT_ADS_TEXT = `Καλησπέρα σας,

Η ITDEV ξεκίνησε να παρέχει τη νέα υπηρεσία ChatGPT Ads, βοηθώντας τις επιχειρήσεις να αξιοποιήσουν ένα νέο και δυναμικό διαφημιστικό κανάλι.

Με την προβολή της επιχείρησής σας στο ChatGPT μπορείτε:

• Να ενισχύσετε την αναγνωρισιμότητα της εταιρείας σας
• Να προσεγγίσετε δυνητικούς πελάτες τη στιγμή που αναζητούν πληροφορίες και λύσεις
• Να αποκτήσετε ανταγωνιστικό πλεονέκτημα σε ένα αναπτυσσόμενο κανάλι
• Να δημιουργήσετε νέες ευκαιρίες επικοινωνίας, πωλήσεων και συνεργασιών

ChatGPT Ads Starter
150€/μήνα + ΦΠΑ

Το πακέτο περιλαμβάνει:

• Δημιουργία και διαχείριση διαφημιστικής καμπάνιας
• Σύνταξη διαφημιστικών κειμένων
• Μηνιαία παρακολούθηση και βελτιστοποίηση
• Αναφορά αποτελεσμάτων

Η τιμή δεν περιλαμβάνει ΦΠΑ 24% και το διαφημιστικό budget.

Για περισσότερες πληροφορίες και για να συζητήσουμε πώς μπορεί να ωφελήσει την επιχείρησή σας, επικοινωνήστε μαζί μας:

Τηλέφωνο: +30 210 260 3414
Email: sales@itdev.gr

Απαντήστε σε αυτό το email ή καλέστε μας για μια σύντομη ενημέρωση, χωρίς καμία δέσμευση.

Με εκτίμηση,

Η ομάδα της ITDEV`;

// Email-safe centered announcement card (tables + inline styles, no shell()):
// optional hero row on top, escaped plain-text body, company signature, grey
// footer line outside the card. Shared by company_announcement + campaigns.
function announcementCard(heroRowHtml: string, raw: string): string {
  const paras = raw
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${linkify(escapeHtml(p.trim())).replace(/\n/g, '<br/>')}</p>`)
    .join('');
  return `<div style="margin:0;padding:24px 12px;background:#f1f5f9">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="600" style="max-width:600px;width:100%;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
${heroRowHtml}
<tr><td style="padding:32px 36px 8px;font-family:Arial,sans-serif;font-size:15px;color:#0f172a;line-height:1.7">
${paras}
</td></tr>
<tr><td style="padding:8px 36px 28px;font-family:Arial,sans-serif">
<hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 4px"/>
${COMPANY_SIG_HTML}
</td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="600" style="max-width:600px;width:100%;margin:0 auto">
<tr><td style="padding:16px 8px;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-align:center">IT DEV · Digital Marketing Agency · <a href="https://www.itdev.gr" style="color:#64748b">www.itdev.gr</a></td></tr>
</table>
</div>`;
}

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
  // Layout: email-safe centered card (tables + inline styles, no shell()).
  company_announcement: (d) => {
    const subject = String(d.subject ?? '').replace(/[\r\n]+/g, ' ');
    const raw = String(d.text ?? '');
    const imgUrl = typeof d.image_url === 'string' && d.image_url.startsWith('https://') ? d.image_url : null;
    const hero = imgUrl
      ? `<tr><td><img src="${escapeHtml(imgUrl)}" alt="IT DEV" width="600" style="width:100%;max-width:600px;height:auto;display:block"/></td></tr>`
      : '';
    return {
      subject,
      html: announcementCard(hero, raw),
      text: raw + '\n\n' + COMPANY_SIG_TEXT,
    };
  },

  // ChatGPT Ads campaign (2026-09): fixed marketing copy + hero asset; the
  // subject carries the lead code like every client-facing sales email.
  // Data: { code } (from lead_email_payload; the rest is ignored).
  // NOTE: never create an email_templates DB row with this key — a DB row
  // shadows the built-in (renderDbTemplate) and the hero would be dropped.
  chatgpt_ads_campaign: (d) => {
    const code = String(d.code ?? '').trim();
    const subject = cleanSubject(`${code} - Νέα Υπηρεσία ChatGPT Ads από την ITDEV`);
    const hero = `<tr><td><img src="${escapeHtml(CHATGPT_ADS_HERO)}" alt="ChatGPT Ads" width="600" style="width:100%;max-width:600px;height:auto;display:block"/></td></tr>`;
    return {
      subject,
      html: announcementCard(hero, CHATGPT_ADS_TEXT),
      text: CHATGPT_ADS_TEXT + '\n\n' + COMPANY_SIG_TEXT,
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

  // Weekly Web Dev status report for the department lead. All values are
  // code-generated by the webdev-weekly-report edge fn (the LLM narrative is
  // plain text) — escaped anyway. Card layout mirrors company_announcement.
  webdev_weekly_report: (d) => {
    const week = escapeHtml(String(d.week_label ?? ''));
    const overview = String(d.overview ?? '');
    const attention = Array.isArray(d.attention) ? d.attention.map((x) => String(x)) : [];
    const totals = (d.totals ?? {}) as Record<string, unknown>;
    const projects = Array.isArray(d.projects) ? (d.projects as Record<string, unknown>[]) : [];
    const isTest = d.test === true;

    const subject = `${isTest ? '[ΔΟΚΙΜΗ] ' : ''}Web Dev — Εβδομαδιαία αναφορά ${String(d.week_label ?? '')}`;

    const FLAG_LABELS: Record<string, string> = {
      stuck: 'Κολλημένο',
      blocked: 'Μπλοκαρισμένο',
      stale: 'Χωρίς κίνηση',
      waiting_client: 'Αναμονή πελάτη',
    };

    const stat = (label: string, value: unknown) =>
      `<td align="center" style="padding:12px 6px;background:#f8fafc;border-radius:8px">
<div style="font-size:22px;font-weight:bold;color:#0f172a">${escapeHtml(String(value ?? 0))}</div>
<div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.4px">${escapeHtml(label)}</div></td>`;

    const overviewHtml = overview
      .split(/\n{2,}/)
      .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p.trim()).replace(/\n/g, '<br/>')}</p>`)
      .join('');

    const attentionHtml = attention.length > 0
      ? `<div style="margin:0 0 20px;padding:14px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px">
<div style="font-weight:bold;color:#92400e;margin-bottom:6px">⚠️ Χρειάζονται προσοχή</div>
<ul style="margin:0;padding-left:18px;color:#78350f">${attention.map((a) => `<li style="margin:2px 0">${escapeHtml(a)}</li>`).join('')}</ul>
</div>`
      : '';

    const rows = projects.map((p) => {
      const flags = Array.isArray(p.flags) ? (p.flags as string[]) : [];
      const flagged = flags.length > 0;
      const flagChips = flags
        .map((f) => `<span style="display:inline-block;padding:1px 6px;margin:1px 2px 1px 0;border-radius:8px;background:#fee2e2;color:#991b1b;font-size:10px">${escapeHtml(FLAG_LABELS[f] ?? f)}</span>`)
        .join('');
      const note = String(p.weekNote ?? '');
      const days = p.daysInStage === null || p.daysInStage === undefined ? '—' : String(p.daysInStage);
      return `<tr style="${flagged ? 'background:#fef2f2' : ''}">
<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:13px">
<div style="font-weight:bold;color:#0f172a">${escapeHtml(String(p.client ?? '—'))}</div>
<div style="font-size:11px;color:#64748b">${escapeHtml(String(p.code ?? ''))}</div>${flagChips ? `<div>${flagChips}</div>` : ''}</td>
<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a">${escapeHtml(String(p.stage ?? '—'))}</td>
<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#334155">${note ? escapeHtml(note) : '<span style="color:#94a3b8">—</span>'}</td>
<td align="center" style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#334155">${escapeHtml(days)}</td>
<td align="center" style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#334155">${escapeHtml(String(p.openTasks ?? 0))}</td>
</tr>`;
    }).join('');

    const tableHtml = projects.length > 0
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 8px">
<tr>
<th align="left" style="padding:6px 10px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.4px;border-bottom:2px solid #e2e8f0">Έργο</th>
<th align="left" style="padding:6px 10px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.4px;border-bottom:2px solid #e2e8f0">Στάδιο</th>
<th align="left" style="padding:6px 10px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.4px;border-bottom:2px solid #e2e8f0">Εβδομάδα</th>
<th align="center" style="padding:6px 10px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.4px;border-bottom:2px solid #e2e8f0">Ημ. στο στάδιο</th>
<th align="center" style="padding:6px 10px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.4px;border-bottom:2px solid #e2e8f0">Tasks</th>
</tr>${rows}</table>`
      : `<p style="color:#64748b">Δεν υπάρχουν ενεργά web dev έργα.</p>`;

    const html = `<div style="margin:0;padding:24px 12px;background:#f1f5f9">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="640" style="max-width:640px;width:100%;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="padding:24px 32px;background:#0f172a">
<div style="font-family:Arial,sans-serif;font-size:18px;font-weight:bold;color:#ffffff">Εβδομαδιαία Αναφορά Web Dev</div>
<div style="font-family:Arial,sans-serif;font-size:13px;color:#94a3b8;margin-top:2px">${week}${isTest ? ' · ΔΟΚΙΜΑΣΤΙΚΗ ΑΠΟΣΤΟΛΗ' : ''}</div>
</td></tr>
<tr><td style="padding:24px 32px 8px;font-family:Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.6">
${overviewHtml}
${attentionHtml}
<table role="presentation" cellpadding="0" cellspacing="6" border="0" width="100%" style="margin:0 0 20px"><tr>
${stat('Ενεργά', totals.active)}${stat('Νέα', totals.newThisWeek)}${stat('Μετακινήθηκαν', totals.movedThisWeek)}${stat('Ολοκληρώθηκαν', totals.completedThisWeek)}
</tr></table>
${tableHtml}
</td></tr>
<tr><td style="padding:8px 32px 24px;font-family:Arial,sans-serif;font-size:11px;color:#94a3b8">
Αυτόματη αναφορά από το IT DEV CRM${d.ai_generated === true ? ' · σύνοψη με AI' : ''} · <a href="${APP_BASE}/tech/web-dev" style="color:#64748b">Άνοιγμα πίνακα Web Dev</a>
</td></tr>
</table>
</div>`;

    const textLines = [
      `Εβδομαδιαία Αναφορά Web Dev — ${String(d.week_label ?? '')}`,
      '',
      overview,
      '',
      ...(attention.length > 0 ? ['Χρειάζονται προσοχή:', ...attention.map((a) => `- ${a}`), ''] : []),
      `Ενεργά: ${totals.active ?? 0} · Νέα: ${totals.newThisWeek ?? 0} · Μετακινήθηκαν: ${totals.movedThisWeek ?? 0} · Ολοκληρώθηκαν: ${totals.completedThisWeek ?? 0}`,
      '',
      ...projects.map((p) => {
        const flags = Array.isArray(p.flags) && p.flags.length > 0 ? ` [${(p.flags as string[]).join(',')}]` : '';
        return `- ${p.client} (${p.code || '—'}): ${p.stage}${p.weekNote ? ` — ${p.weekNote}` : ''}, tasks: ${p.openTasks ?? 0}${flags}`;
      }),
    ];
    return { subject, html, text: textLines.join('\n') };
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
  // Optional signature override: the owner-Gmail transport injects the
  // sender's PERSONAL signature instead of the company block.
  opts?: { sigHtml?: string },
): Rendered {
  const subject = cleanSubject(interpolate(row.subject, data));
  // Admin-edited bodies may carry markdown-lite markup (**bold**, ## heading,
  // - bullets, links). One shared renderer feeds both the HTML and the
  // plain-text part — and the admin preview uses the same module.
  const body = renderEmailMarkup(interpolate(row.body, data));
  const bodyText = body.text;
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
  const sig = opts?.sigHtml !== undefined
    ? opts.sigHtml
    : (row.client_facing !== false ? COMPANY_SIG_HTML : '');
  const html = shell(
    `${body.html}${cta}${footer}`,
    sig,
  );
  return {
    subject,
    html,
    text: opts?.sigHtml === undefined && sig !== ''
      ? `${bodyText}\n\n${COMPANY_SIG_TEXT}`
      : bodyText + footerText,
  };
}

export function renderTemplate(templateKey: string, data: Record<string, unknown>): Rendered {
  const fn = TEMPLATES[templateKey];
  if (!fn) throw new Error(`Unknown template: ${templateKey}`);
  return fn(data ?? {});
}
