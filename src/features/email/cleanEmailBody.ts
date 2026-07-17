// Non-destructive, render-time cleanup of a plain-text email body.
//
// The Emails tab renders `body_text` verbatim, so each message shows the full
// quoted reply chain plus everyone's signature — unreadable. This helper trims
// that noise for DISPLAY only; the stored row is never touched, and the UI keeps
// a "show original" toggle so nothing is truly hidden.
//
// Two independent cuts, applied in order to the plain text:
//   1. Quote chain — drop everything from the first quote boundary down.
//      Real formats seen in prod: Gmail "On <date> … wrote:" (with > / >> lines,
//      and the header can wrap across two lines), Zoho "---- On <date> … wrote ----"
//      (no > prefix), Greek "Στις <date> … έγραψε:", and Outlook separators.
//   2. Trailing signature — drop from the first sign-off line down. Both we and
//      our Greek clients close with «Με (ιδιαίτερη) εκτίμηση,», so one anchor set
//      removes both parties' signatures reliably.
//
// Conservative by design: it only cuts at recognised anchors, and if cleaning
// would empty the message (e.g. a body that is nothing but a quote) it falls
// back to the untouched original — a card is never left blank.

export type CleanedBody = {
  /** The new message, with quote chain + trailing signature removed. */
  visible: string;
  /** True when anything was removed (so the UI shows a "show original" toggle). */
  hasHidden: boolean;
};

// Quote-chain openers. Cut at the earliest match. Non-global so exec() scans
// from the start each time; `[\s\S]{0,200}?` lets the Gmail header wrap a line.
const QUOTE_BOUNDARIES: readonly RegExp[] = [
  // Zoho: "---- On Fri, 17 Jul 2026 08:40:20 +0300 marios@itdev.gr wrote ----"
  /^[ \t>]*-{2,}\s*On\s.+?\swrote\s*-{2,}/im,
  // Gmail (EN): "On Mon, Jul 13, 2026 at 3:36 PM Name <email> wrote:"
  /^[ \t>]*On\s[\s\S]{0,200}?\swrote:/im,
  // Gmail (EL): "Στις <ημερομηνία> ... έγραψε:"
  /^[ \t>]*Στις\s[\s\S]{0,200}?\sέγραψε:/im,
  // Outlook
  /^[ \t>]*-{3,}\s*Original Message\s*-{3,}/im,
];

// A line that IS a closing sign-off (optionally quote/bullet-prefixed, optional
// trailing comma). Everything from here down is signature. No \b word-boundary:
// JS \b is ASCII-only and never matches after a Greek letter, so the line-end
// anchor ($) is what keeps the match to a bare sign-off line.
const SIGNOFF_BOUNDARY =
  /^[ \t>*]*(Με\s+(?:ιδιαίτερη\s+)?εκτίμηση|Με\s+φιλικούς\s+χαιρετισμούς|Φιλικά|Best\s+regards|Kind\s+regards|Warm\s+regards|Regards|Sincerely|Cheers)[ \t]*,?[ \t]*\r?$/im;

/** Earliest start index among the regexes, or -1 if none match. */
function firstBoundary(text: string, regexes: readonly RegExp[]): number {
  let min = -1;
  for (const re of regexes) {
    const m = re.exec(text);
    if (m && (min === -1 || m.index < min)) min = m.index;
  }
  return min;
}

export function cleanEmailBody(raw: string): CleanedBody {
  const original = (raw ?? '').replace(/\r\n/g, '\n').trimEnd();
  if (!original.trim()) return { visible: original.trim(), hasHidden: false };

  let cut = original;

  // 1. Quote chain
  const qi = firstBoundary(cut, QUOTE_BOUNDARIES);
  if (qi >= 0) cut = cut.slice(0, qi);

  // 2. Trailing signature (on what's left of the top message)
  const si = firstBoundary(cut, [SIGNOFF_BOUNDARY]);
  if (si >= 0) cut = cut.slice(0, si);

  // 3. Cosmetic: drop inline image placeholders and collapse blank runs
  const visible = cut
    .replace(/\[image:[^\]]*\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Fallback: never return an empty body.
  if (!visible) return { visible: original.trim(), hasHidden: false };

  return { visible, hasHidden: visible !== original.trim() };
}
