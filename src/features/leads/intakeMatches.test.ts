import { describe, it, expect } from 'vitest';
import { leadMatchesOf } from './intakeMatches';
import type { LeadIntakeMatch } from './hooks/useLeadIntake';

const m = (over: Partial<LeadIntakeMatch>): LeadIntakeMatch => ({
  match_type: 'lead',
  record_id: 'L1',
  display_name: 'X',
  context: null,
  matched_field: 'email',
  matched_email: null,
  matched_phone: null,
  ...over,
});

describe('leadMatchesOf', () => {
  it('keeps only pipeline-lead matches', () => {
    const out = leadMatchesOf([
      m({ match_type: 'lead', record_id: 'L1' }),
      m({ match_type: 'deal_client', record_id: 'C1' }),
      m({ match_type: 'queued', record_id: 'Q1' }),
      m({ match_type: 'lead', record_id: 'L2' }),
    ]);
    expect(out.map((x) => x.record_id)).toEqual(['L1', 'L2']);
  });

  it('returns empty when there are no lead matches', () => {
    expect(leadMatchesOf([m({ match_type: 'deal_client' })])).toEqual([]);
  });
});
