// Pure, dependency-light rendering for marketing campaign emails.
//
// Runs in BOTH Deno (send-campaign/index.ts, this function's real send path)
// AND Vite/vitest (render.test.ts here, and — Φάση 1β — the admin UI's
// campaign preview), so this file must never reference Deno or browser
// globals. The only import is `renderEmailMarkup` from `_shared/emailMarkup.ts`,
// which is deliberately built to run in both runtimes for the same reason
// (see that file's header comment) — using it here means the UI preview will
// always match what is actually sent.
//
// This file does NOT import from `send-email/templates.ts`. That file's
// `announcementCard(...)` is the layout a campaign email would ideally reuse,
// but it is a private (non-exported) function, and the Task 5 brief is
// explicit that `send-email/index.ts` and `templates.ts` must not change for
// this task. Rather than exporting it, this is a small, independent card
// layout — visually similar (centered white card on a grey page, Arial,
// inline styles for email-client safety) but deliberately NOT the same
// function: a future edit to the transactional templates can never
// accidentally change what a campaign recipient sees, and vice versa.

import { renderEmailMarkup } from '../_shared/emailMarkup.ts';

export type RenderCampaignEmailArgs = {
  bodyMd: string;
  heroImageUrl: string | null;
  displayName: string | null;
  unsubscribeUrl: string;
};

export type RenderedCampaignEmail = { html: string; text: string };

const CARD_WIDTH = 600;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Time-agnostic Greek greeting. A missing/blank display name falls back to a
 *  neutral group greeting — never an empty line, never "undefined". */
function greetingLine(displayName: string | null): string {
  const name = (displayName ?? '').trim();
  return name ? `Γεια σας, ${name}!` : 'Γεια σας,';
}

/** Renders one recipient's campaign email. Pure: no I/O, no randomness
 *  besides what the caller passes in (`unsubscribeUrl` is built by the
 *  caller from the recipient's own row). */
export function renderCampaignEmail(args: RenderCampaignEmailArgs): RenderedCampaignEmail {
  const { bodyMd, heroImageUrl, displayName, unsubscribeUrl } = args;
  const greeting = greetingLine(displayName);
  const { html: bodyHtml, text: bodyText } = renderEmailMarkup(bodyMd);

  const heroRow =
    heroImageUrl && heroImageUrl.startsWith('https://')
      ? `<tr><td><img src="${escapeHtml(heroImageUrl)}" alt="IT DEV" width="${CARD_WIDTH}" style="width:100%;max-width:${CARD_WIDTH}px;height:auto;display:block"/></td></tr>`
      : '';

  const safeUnsubUrl = escapeHtml(unsubscribeUrl);

  const html = `<div style="margin:0;padding:24px 12px;background:#f1f5f9">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="${CARD_WIDTH}" style="max-width:${CARD_WIDTH}px;width:100%;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
${heroRow}
<tr><td style="padding:32px 36px 8px;font-family:Arial,sans-serif;font-size:15px;color:#0f172a;line-height:1.7">
<p style="margin:0 0 16px">${escapeHtml(greeting)}</p>
${bodyHtml}
</td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="${CARD_WIDTH}" style="max-width:${CARD_WIDTH}px;width:100%;margin:0 auto">
<tr><td style="padding:16px 8px;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-align:center">
IT DEV · Digital Marketing Agency · <a href="https://www.itdev.gr" style="color:#64748b">www.itdev.gr</a><br/>
<a href="${safeUnsubUrl}" style="color:#64748b">Απεγγραφή από τα ενημερωτικά email</a>
</td></tr>
</table>
</div>`;

  const text = `${greeting}

${bodyText}

---
IT DEV · www.itdev.gr
Για να μη λαμβάνετε πλέον ενημερωτικά email από εμάς: ${unsubscribeUrl}`;

  return { html, text };
}

/** Tags are the ONLY way the resend-webhook can attribute a delivery/bounce/
 *  complaint event back to a campaign + recipient (Task 6). Exactly these
 *  three, always in this shape — `mkt` lets the webhook cheaply recognise a
 *  campaign send before doing anything else. Resend tag names/values allow
 *  only ASCII letters, digits, `_` and `-`; UUIDs already qualify. */
export function campaignTags(
  campaignId: string,
  recipientId: string,
): { name: string; value: string }[] {
  return [
    { name: 'mkt', value: '1' },
    { name: 'campaign', value: campaignId },
    { name: 'recipient', value: recipientId },
  ];
}

/** Gmail/Yahoo bulk-sender requirements: both headers, angle brackets around
 *  the URL in List-Unsubscribe, and the literal One-Click value. */
export function unsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
