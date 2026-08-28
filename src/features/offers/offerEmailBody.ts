// Pure assembly of the offer email from email_templates composer rows.
// The result is HTML for the RichTextEditor, sent as templateKey 'custom' —
// it must stay inside the sanitizeEmailHtml allowlist (p/br/strong etc., no <h*>).

export type OfferEmailVars = {
  name: string;
  owner_name: string;
  offer_number: string;
  validity_days: number;
  /** Public no-login link (https://www.itdevcrm.com/o/<public_token>). */
  offer_url: string;
};

export type OfferTemplate = { key: string; subject: string; body: string };

/** Mirrors the server's interpolate (send-email/templates.ts): unknown keys → ''. */
export function interpolate(tpl: string, data: Record<string, string | number>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => String(data[k] ?? ''));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Bare http(s) URLs in already-escaped text become links (mirrors the server's
 *  linkify in send-email/templates.ts; sanitizeEmailHtml allows <a href>). */
function linkify(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
}

/** Plain template text → paragraphs: blank-line-separated blocks become <p>,
 *  single newlines inside a block become <br>, URLs become links. */
export function textToHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${linkify(escapeHtml(block)).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** Assemble the offer email: intro (subject + body with the offer link) and
 *  the CTA outro. Service descriptions live in the generated PDF, not here. */
export function buildOfferEmail(opts: {
  intro: OfferTemplate;
  outro: OfferTemplate;
  vars: OfferEmailVars;
}): { subject: string; html: string } {
  const { intro, outro, vars } = opts;
  const subject = interpolate(intro.subject, vars);
  const html = textToHtml(interpolate(intro.body, vars)) + textToHtml(interpolate(outro.body, vars));
  return { subject, html };
}
