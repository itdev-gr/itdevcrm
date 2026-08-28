// Best-effort detector for link-scanner / preview-bot user agents, used by
// the public offer viewer so an email scanner's prefetch is recorded but not
// surfaced as "the client opened the offer". Known limitation: a scanner
// spoofing a plain browser UA passes through — accepted for v1.
const BOT_UA_RE =
  /bot|crawler|spider|preview|scan|fetch|monitor|GoogleImageProxy|facebookexternalhit|Slack|WhatsApp|Telegram|Skype|LinkedIn|Discord|Twitterbot|HeadlessChrome|Google-Safety|AhrefsSiteAudit/i;

export function isSuspectedBotUa(userAgent: string | undefined | null): boolean {
  const ua = (userAgent ?? '').trim();
  if (ua.length === 0) return true; // no UA at all → almost certainly not a person's browser
  return BOT_UA_RE.test(ua);
}
