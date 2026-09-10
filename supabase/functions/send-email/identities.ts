export type Identity = 'sales' | 'accounting' | 'internal' | 'info' | 'marketing';

export const IDENTITIES: Record<Identity, { from: string; replyTo: string }> = {
  sales: { from: 'ITDEV <sales@itdev.gr>', replyTo: 'sales@itdev.gr' },
  info: { from: 'IT DEV <info@itdev.gr>', replyTo: 'info@itdev.gr' },
  accounting: { from: 'ITDEV Λογιστήριο <accounting@itdev.gr>', replyTo: 'accounting@itdev.gr' },
  internal: { from: 'ITDEV <noreply@itdev.gr>', replyTo: 'noreply@itdev.gr' },
  // Marketing campaigns (send-campaign edge function) only — never used by the
  // automated transactional paths in this file. reply-to is a synced mailbox
  // (sales@) so replies are visible in Φάση 2's reply tracking.
  //
  // Owner decision 2026-09-10 (supersedes 2026-09-07's sales@ choice):
  // campaigns send FROM offer@itdev.gr; replies keep going to sales@ so the
  // CRM reply tracking still sees them (offer@ is NOT a synced mailbox).
  // Campaign spam complaints now hit offer@, no longer the sales address —
  // the 2026-09-07 deliverability concern (2) is thereby resolved.
  //
  // Open/click tracking stays DORMANT, NOT REMOVED. Resend toggles tracking
  // per DOMAIN with no per-send override, so enabling it on itdev.gr would
  // put a pixel and rewritten links in invoices and contracts too. Everything
  // tracking needs is already built and must stay: the open/click columns on
  // email_campaign_recipients, the campaign branch in resend-webhook, and the
  // «δεν μετράται» tiles. Turning it on later = verify a marketing subdomain
  // (e.g. news.itdev.gr) as its own Resend domain, enable tracking only there,
  // and change the `from` below. No code is rebuilt.
  marketing: { from: 'ITDEV <offer@itdev.gr>', replyTo: 'sales@itdev.gr' },
};
