import { describe, it, expect } from 'vitest';
import { parseColumnarMetaLead } from './meta-lead';

// A real captured Meta → Excel → Zapier row (COL$ format).
const sample: Record<string, unknown> = {
  'COL$A': 'l:987882727319006',
  'COL$B': '2026-06-22T00:51:45-05:00',
  'COL$C': 'ag:120240335093640494',
  'COL$D': 'Προώθηση ανεύρεσης υποψήφιων πελατών: AI SEO',
  'COL$E': 'as:120240335093500494',
  'COL$F': '[20/12/2025] Προωθείται η Σελίδα AI SEO (ad set)',
  'COL$G': 'c:120240335093400494',
  'COL$H': '[20/12/2025] Προωθείται η Σελίδα AI SEO (campaign)',
  'COL$I': 'f:711549071695221',
  'COL$J': 'AI SEO για σύγχρονες επιχειρήσεις',
  'COL$K': 'false',
  'COL$L': 'fb',
  'COL$M': 'ναι',
  'COL$N': 'Maria Ziarou',
  'COL$O': 'p:+306940702133',
  'COL$P': 'mziarou@gmail.com',
  'COL$Q': 'Αυτοαπασχολούμενος',
  'COL$R': '',
  'COL$S': 'CREATED',
  id: '1188',
  row: '1188',
};

describe('parseColumnarMetaLead', () => {
  it('maps the COL$ format into named fields + a lead-info block', () => {
    const r = parseColumnarMetaLead(sample);
    expect(r).not.toBeNull();
    expect(r!.leadgenId).toBe('987882727319006'); // l: stripped → real Meta lead id
    expect(r!.fullName).toBe('Maria Ziarou');
    expect(r!.phone).toBe('+306940702133'); // p: stripped
    expect(r!.email).toBe('mziarou@gmail.com');
    expect(r!.formName).toBe('AI SEO για σύγχρονες επιχειρήσεις');
    expect(r!.website).toBeNull();
    expect(r!.noteBlock).toContain('Form: AI SEO για σύγχρονες επιχειρήσεις');
    expect(r!.noteBlock).toContain('Platform: Facebook'); // fb → Facebook
    expect(r!.noteBlock).toContain('Submitted: 22/06/2026'); // date reformatted
    expect(r!.noteBlock).toContain('ναι'); // answers included
    expect(r!.noteBlock).toContain('Αυτοαπασχολούμενος');
  });

  it('treats a URL COL$R as website (Instagram), omitting it from answers', () => {
    const r = parseColumnarMetaLead({
      ...sample,
      'COL$R': 'https://www.matinaspell.com/',
      'COL$L': 'ig',
    });
    expect(r!.website).toBe('https://www.matinaspell.com/');
    expect(r!.noteBlock).toContain('Platform: Instagram');
    const answersPart = r!.noteBlock!.split('Answers:')[1] ?? '';
    expect(answersPart).not.toContain('matinaspell.com');
  });

  it('returns null for a non-columnar (named-field) payload', () => {
    expect(
      parseColumnarMetaLead({ email: 'x@y.gr', phone: '123', full_name: 'A B' }),
    ).toBeNull();
  });
});
