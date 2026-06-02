export type Identity = 'sales' | 'accounting' | 'internal';

export const IDENTITIES: Record<Identity, { from: string; replyTo: string }> = {
  sales: { from: 'ITDev <sales@itdev.gr>', replyTo: 'sales@itdev.gr' },
  accounting: { from: 'ITDev Λογιστήριο <accounting@itdev.gr>', replyTo: 'accounting@itdev.gr' },
  internal: { from: 'ITDev <noreply@itdev.gr>', replyTo: 'noreply@itdev.gr' },
};
