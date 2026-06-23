import { describe, it, expect } from 'vitest';
import { leadMatchesOf, coldLeadMatchesOf } from './intakeMatches';
import type { LeadIntakeMatch } from './hooks/useLeadIntake';

const m = (o: Partial<LeadIntakeMatch>): LeadIntakeMatch =>
  ({ match_type: 'lead', record_id: 'x', display_name: 'X', ...o } as LeadIntakeMatch);

describe('intakeMatches', () => {
  it('leadMatchesOf keeps only lead matches', () => {
    const out = leadMatchesOf([m({ record_id: 'a' }), m({ match_type: 'deal_client', record_id: 'c' })]);
    expect(out.map((x) => x.record_id)).toEqual(['a']);
  });

  it('coldLeadMatchesOf keeps lead matches whose id is in the cold set', () => {
    const matches = [m({ record_id: 'cold1' }), m({ record_id: 'warm1' }), m({ match_type: 'deal_client', record_id: 'cold1' })];
    const out = coldLeadMatchesOf(matches, new Set(['cold1']));
    expect(out.map((x) => x.record_id)).toEqual(['cold1']);
  });
});
