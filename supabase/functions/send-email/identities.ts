export type Identity = 'sales' | 'accounting' | 'internal' | 'info' | 'marketing';

export const IDENTITIES: Record<Identity, { from: string; replyTo: string }> = {
  sales: { from: 'ITDEV <sales@itdev.gr>', replyTo: 'sales@itdev.gr' },
  info: { from: 'IT DEV <info@itdev.gr>', replyTo: 'info@itdev.gr' },
  accounting: { from: 'ITDEV Λογιστήριο <accounting@itdev.gr>', replyTo: 'accounting@itdev.gr' },
  internal: { from: 'ITDEV <noreply@itdev.gr>', replyTo: 'noreply@itdev.gr' },
  // Marketing campaigns (send-campaign edge function) only — never used by the
  // automated transactional paths in this file. reply-to MUST be a synced
  // mailbox (sales@) so replies are visible in Φάση 2's reply tracking.
  marketing: { from: 'IT DEV <news@itdev.gr>', replyTo: 'sales@itdev.gr' },
};
