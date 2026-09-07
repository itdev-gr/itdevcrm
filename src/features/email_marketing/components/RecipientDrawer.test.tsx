import { describe, it, expect } from 'vitest';
import { recipientRowsToCSV } from './RecipientDrawer';
import type { CampaignRecipientRow } from '../hooks/useCampaigns';

function makeRow(overrides: Partial<CampaignRecipientRow> = {}): CampaignRecipientRow {
  return {
    id: 'r1',
    campaign_id: 'camp-1',
    email_lower: 'jane@example.com',
    display_name: 'Jane Doe',
    company: 'ACME, "Athens"',
    lead_id: null,
    client_id: null,
    audience_id: null,
    status: 'sent',
    suppression_reason: null,
    unsubscribe_token: 'tok',
    resend_id: null,
    attempts: 1,
    claimed_at: null,
    error: null,
    queued_at: '2026-09-07T08:00:00Z',
    sent_at: '2026-09-07T08:01:00Z',
    delivered_at: '2026-09-07T08:02:00Z',
    bounced_at: null,
    bounce_type: null,
    complained_at: null,
    unsubscribed_at: null,
    open_count: 0,
    click_count: 0,
    first_opened_at: null,
    first_clicked_at: null,
    replied_at: null,
    ...overrides,
  };
}

describe('recipientRowsToCSV', () => {
  it('emits a header row and one data row per recipient', () => {
    const csv = recipientRowsToCSV([makeRow(), makeRow({ id: 'r2', email_lower: 'bob@example.com' })]);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^email_lower,display_name,company/);
  });

  it('escapes embedded commas and double-quotes', () => {
    const csv = recipientRowsToCSV([makeRow()]);
    expect(csv).toContain('"ACME, ""Athens"""');
  });

  it('includes the failure reason and suppression reason columns', () => {
    const csv = recipientRowsToCSV([
      makeRow({ id: 'r3', status: 'failed', error: 'bounced hard' }),
      makeRow({ id: 'r4', status: 'suppressed', suppression_reason: 'opted_out' }),
    ]);
    expect(csv).toContain('bounced hard');
    expect(csv).toContain('opted_out');
  });
});
