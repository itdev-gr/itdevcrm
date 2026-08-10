export type Identity = 'sales' | 'accounting' | 'internal' | 'info';

export const IDENTITIES: Record<Identity, { from: string; replyTo: string }> = {
  sales: { from: 'ITDEV <sales@itdev.gr>', replyTo: 'sales@itdev.gr' },
  info: { from: 'IT DEV <info@itdev.gr>', replyTo: 'info@itdev.gr' },
  accounting: { from: 'ITDEV Λογιστήριο <accounting@itdev.gr>', replyTo: 'accounting@itdev.gr' },
  internal: { from: 'ITDEV <noreply@itdev.gr>', replyTo: 'noreply@itdev.gr' },
};
