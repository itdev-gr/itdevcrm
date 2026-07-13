// Branded IT DEV email signature — the single source of truth for BOTH the
// send-email edge function (Deno) and the frontend preview (Vite/vitest).
// Keep this file dependency-free and free of Deno/browser globals so both
// runtimes can import it. Layout is fixed for everyone (owner decision
// 2026-07-13); only the four person fields vary.

export type SignaturePerson = {
  name: string;
  title?: string | null;
  phone?: string | null;
  email?: string | null;
};

export const SIGNATURE_COMPANY: SignaturePerson = {
  name: 'IT DEV',
  title: 'Digital Marketing Agency',
  phone: '+30 210 260 3414',
  email: 'info@itdev.gr',
};

const ADDRESS = 'Argous 139, Athens, 104 41';
const WEBSITE_LABEL = 'www.itdev.gr';
const WEBSITE_URL = 'https://www.itdev.gr';

const DISCLAIMER_LABEL = 'ΑΠΟΠΟΙΗΣΗ ΕΥΘΥΝΗΣ:';
const DISCLAIMER_BODY =
  'Το περιεχόμενο του παρόντος email είναι εμπιστευτικό και προορίζεται αποκλειστικά για τον/την παραλήπτη/παραλήπτρια που αναφέρεται στο μήνυμα. Απαγορεύεται αυστηρά η κοινοποίηση, αναπαραγωγή ή διανομή οποιουδήποτε μέρους του μηνύματος σε τρίτους χωρίς την έγγραφη συγκατάθεση του αποστολέα. Εάν λάβατε αυτό το μήνυμα κατά λάθος, παρακαλώ απαντήστε σε αυτό το email και προβείτε στη διαγραφή του, ώστε να διασφαλίσουμε ότι δεν θα επαναληφθεί παρόμοιο σφάλμα στο μέλλον.';
const NOTE_LABEL = 'Επιπλέον σημείωση:';
const NOTE_BODY =
  'Για οποιοδήποτε αίτημα ή αλλαγή που αφορά τις υπηρεσίες μας, παρακαλούμε όπως γίνεται αποστολή γραπτού αιτήματος μέσω email. Αυτό είναι σημαντικό προκειμένου να διατηρείται αρχείο και να διασφαλίζεται η ορθή παρακολούθηση και διαχείριση των ενεργειών.';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Email-safe HTML (nested tables + inline styles — no flexbox, no classes).
 * Defaults to the company block; pass a person for the personal variant.
 * Empty title/phone rows are omitted.
 */
export function renderSignatureHtml(
  logoUrl: string,
  person: SignaturePerson = SIGNATURE_COMPANY,
): string {
  const rows: string[] = [`<b style="font-size:14px">${esc(person.name)}</b>`];
  if (person.title) rows.push(`<span style="color:#2563eb">${esc(person.title)}</span>`);
  if (person.phone) rows.push(`Tel.: ${esc(person.phone)}`);
  rows.push(`A.: ${esc(ADDRESS)}`);
  if (person.email) {
    rows.push(
      `E: <a href="mailto:${esc(person.email)}" style="color:#2563eb">${esc(person.email)}</a>`,
    );
  }
  rows.push(`Web: <a href="${WEBSITE_URL}" style="color:#2563eb">${WEBSITE_LABEL}</a>`);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px">
<tr><td style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;padding-bottom:14px">Με εκτίμηση,</td></tr>
<tr><td><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;padding-right:16px"><img src="${esc(logoUrl)}" width="80" height="80" alt="IT DEV" style="display:block;border-radius:50%"/></td>
<td style="border-left:2px solid #d1d5db;padding-left:16px;font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:#0f172a">${rows.join('<br/>')}</td>
</tr></table></td></tr>
<tr><td style="padding-top:22px;font-family:Arial,sans-serif;font-size:10px;line-height:1.6;color:#6b7280">
<b>${DISCLAIMER_LABEL}</b> ${DISCLAIMER_BODY}<br/>
<b>${NOTE_LABEL}</b> ${NOTE_BODY}
</td></tr>
</table>`;
}

/** Plain-text rendering for the text/plain part of automated sends. */
export function renderSignatureText(person: SignaturePerson = SIGNATURE_COMPANY): string {
  const lines = ['Με εκτίμηση,', '', person.name];
  if (person.title) lines.push(person.title);
  if (person.phone) lines.push(`Tel.: ${person.phone}`);
  lines.push(`A.: ${ADDRESS}`);
  if (person.email) lines.push(`E: ${person.email}`);
  lines.push(`Web: ${WEBSITE_LABEL}`);
  lines.push('', `${DISCLAIMER_LABEL} ${DISCLAIMER_BODY}`, `${NOTE_LABEL} ${NOTE_BODY}`);
  return lines.join('\n');
}
