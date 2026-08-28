import { renderEmailMarkup } from '../../../supabase/functions/_shared/emailMarkup.ts';

/** HTML for the admin "Προεπισκόπηση" box — the SAME renderer send-email uses,
 *  so what admins see is what the client receives (minus shell + signature).
 *  Safe to inject: the renderer HTML-escapes the body before adding markup tags. */
export function templatePreviewHtml(body: string): string {
  return renderEmailMarkup(body).html;
}
