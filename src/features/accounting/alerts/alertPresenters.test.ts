import { describe, it, expect } from 'vitest';
import { groupAlerts, alertLink, severityLabel, type AlertRow } from './alertPresenters';
const mk = (o: Partial<AlertRow>): AlertRow => ({ check_key:'x',severity:'amber',category:'money',subject_type:'deal',subject_id:'s',subject_code:'000001',title:'t',detail:'d',deal_id:'D',job_id:null,signature:'', ...o });
describe('alertPresenters', () => {
  it('links deal-first (deal > client > job)', () => {
    expect(alertLink(mk({ job_id:'J', deal_id:'D' }))).toBe('/deals/D');
    expect(alertLink(mk({ job_id:'J', deal_id:null }))).toBe('/jobs/J');
    expect(alertLink(mk({ job_id:null, deal_id:null, subject_type:'client', subject_id:'C1' }))).toBe('/clients/C1');
    expect(alertLink(mk({ job_id:null, deal_id:null }))).toBeNull();
  });
  it('maps severity to importance label', () => {
    expect(severityLabel('red')).toBe('High');
    expect(severityLabel('amber')).toBe('Medium');
    expect(severityLabel('grey')).toBe('Low');
  });
  it('groups in money→lifecycle→missing order', () => {
    const g = groupAlerts([mk({category:'missing'}), mk({category:'money'}), mk({category:'lifecycle'})]);
    expect(g.map(x=>x.category)).toEqual(['money','lifecycle','missing']);
  });
});
