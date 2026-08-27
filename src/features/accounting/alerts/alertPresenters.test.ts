import { describe, it, expect } from 'vitest';
import { groupAlerts, groupAlertsBySubject, alertLink, alertLinkLabel, severityLabel, type AlertRow } from './alertPresenters';
const mk = (o: Partial<AlertRow>): AlertRow => ({ check_key:'x',severity:'amber',category:'money',subject_type:'deal',subject_id:'s',subject_code:'000001',title:'t',detail:'d',deal_id:'D',job_id:null,signature:'', ...o });
describe('alertPresenters', () => {
  it('links deal-first (deal > client > job)', () => {
    expect(alertLink(mk({ job_id:'J', deal_id:'D' }))).toBe('/deals/D');
    expect(alertLink(mk({ job_id:'J', deal_id:null }))).toBe('/jobs/J');
    expect(alertLink(mk({ job_id:null, deal_id:null, subject_type:'client', subject_id:'C1' }))).toBe('/clients/C1');
    expect(alertLink(mk({ job_id:null, deal_id:null }))).toBeNull();
  });
  it('links the new money checks (26-30, Task 5) by their subject_type', () => {
    // 26 payment_vat_mismatch, 27 paid_backdate_gap, 28 payment_missing_dates:
    // subject_type 'deal_payment', but deal_id is always set — falls through
    // to the deal branch with no special-casing.
    expect(
      alertLink(mk({ check_key: 'payment_vat_mismatch', subject_type: 'deal_payment', deal_id: 'D1', job_id: null })),
    ).toBe('/deals/D1');
    expect(
      alertLink(mk({ check_key: 'paid_backdate_gap', subject_type: 'deal_payment', deal_id: 'D2', job_id: null })),
    ).toBe('/deals/D2');
    expect(
      alertLinkLabel(mk({ check_key: 'payment_missing_dates', subject_type: 'deal_payment', deal_id: 'D3', job_id: null })),
    ).toBe('Open deal');
    // 29 expense_stale_pending, 30 expense_zero_vat_streak: subject_type
    // 'expense', no deal_id/job_id — routes to the expenses list.
    expect(
      alertLink(mk({ check_key: 'expense_stale_pending', subject_type: 'expense', deal_id: null, job_id: null })),
    ).toBe('/accounting/expenses');
    expect(
      alertLinkLabel(mk({ check_key: 'expense_zero_vat_streak', subject_type: 'expense', deal_id: null, job_id: null })),
    ).toBe('Open expenses');
  });

  it('maps severity to importance label', () => {
    expect(severityLabel('red')).toBe('High');
    expect(severityLabel('amber')).toBe('Medium');
    expect(severityLabel('grey')).toBe('Low');
  });
  it('groups by subject base code (deal + its job together), worst-severity first', () => {
    const g = groupAlertsBySubject([
      mk({ subject_code: '000084-LOCALSEO', severity: 'amber' }),
      mk({ subject_code: '000084', severity: 'red' }),
      mk({ subject_code: '000090', severity: 'grey' }),
    ]);
    expect(g.map((x) => x.code)).toEqual(['000084', '000090']); // 000084 first (has a red)
    expect(g[0]!.rows.length).toBe(2); // deal + its job merged under 000084
    expect(g[0]!.rows[0]!.severity).toBe('red'); // rows sorted by severity within a group
  });
  it('groups in money→lifecycle→missing order', () => {
    const g = groupAlerts([mk({category:'missing'}), mk({category:'money'}), mk({category:'lifecycle'})]);
    expect(g.map(x=>x.category)).toEqual(['money','lifecycle','missing']);
  });
});
