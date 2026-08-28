import { renderEmailMarkup } from '../../../supabase/functions/_shared/emailMarkup.ts';
import { textToHtml } from '../offers/offerEmailBody';

// Offer composer rows (`email_templates` keys matching this pattern) are NOT
// sent through the shared markup renderer — src/features/offers/offerEmailBody.ts
// assembles them client-side with textToHtml() and ships them as `custom` HTML.
// So markup like **bold** / "## " / "- " never renders for these keys; showing
// the markup hint or the renderer preview there would be actively misleading.
const OFFER_KEY_RE = /^(ud_)?offer_/;

export function templateSupportsMarkup(key: string): boolean {
  return !OFFER_KEY_RE.test(key);
}

/** HTML for the admin "Προεπισκόπηση" box.
 *  For renderer-backed keys: the SAME renderer send-email uses, so what admins
 *  see is what the client receives (minus shell + signature). Safe to inject:
 *  the renderer HTML-escapes the body before adding markup tags.
 *  For offer_* / ud_offer_* composer keys: the plain textToHtml() preview that
 *  mirrors what offerEmailBody.ts actually sends — markup markers stay literal. */
export function templatePreviewHtml(body: string, key?: string): string {
  if (key !== undefined && !templateSupportsMarkup(key)) return textToHtml(body);
  return renderEmailMarkup(body).html;
}
