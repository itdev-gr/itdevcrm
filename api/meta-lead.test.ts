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

  // A form with TWO custom questions (COL$M + COL$N) shifts name/phone/email one column
  // to the right: name lands in COL$O, phone COL$P, email COL$Q. A fixed COL$N mapping
  // wrongly reads the second answer as the name — this is the website-form bug.
  const websiteSample: Record<string, unknown> = {
    'COL$A': '1277989627509462',
    'COL$B': '2026-07-02 14:30:36',
    'COL$C': '120250937525590494',
    'COL$D': 'Προώθηση ανεύρεσης υποψήφιων πελατών: 🌐 WEBSITE LEAD FORM — ITDEV-copy',
    'COL$E': '120250937525610494',
    'COL$F': 'Προώθηση ανεύρεσης υποψήφιων πελατών: 🌐 WEBSITE LEAD FORM — ITDEV-copy',
    'COL$G': '120250937525650494',
    'COL$H': '[29/6/2026] Προωθείται η Σελίδα 🌐 WEBSITE LEAD FORM — ITDEV-copy',
    'COL$I': '1291532209686171',
    'COL$J': '🌐 WEBSITE LEAD FORM — ITDEV-copy',
    'COL$K': '',
    'COL$L': 'fb',
    'COL$M': 'επαγγελματική_εικόνα_&_εμπιστοσύνη',
    'COL$N': 'Όχι, χρειάζομαι νέο website',
    'COL$O': 'Petros Tsampouris',
    'COL$P': '306972932608',
    'COL$Q': 'ptsampouris@gmail.com',
    'COL$R': 'lithos',
    'COL$S': 'http://stampotadapeda.blogspot.com/',
    id: '58',
    row: '58',
  };

  it('reads name/phone/email by position relative to the email column (2-question form)', () => {
    const r = parseColumnarMetaLead(websiteSample);
    expect(r).not.toBeNull();
    expect(r!.fullName).toBe('Petros Tsampouris'); // NOT the answer in COL$N
    expect(r!.phone).toBe('306972932608');
    expect(r!.email).toBe('ptsampouris@gmail.com');
    expect(r!.website).toBe('http://stampotadapeda.blogspot.com/');
    expect(r!.formName).toBe('🌐 WEBSITE LEAD FORM — ITDEV-copy');
    // Both question answers still surface in the note block for sales.
    expect(r!.noteBlock).toContain('Όχι, χρειάζομαι νέο website');
    expect(r!.noteBlock).toContain('επαγγελματική_εικόνα_&_εμπιστοσύνη');
    // The website URL is not repeated as an answer.
    const answersPart = r!.noteBlock!.split('Answers:')[1] ?? '';
    expect(answersPart).not.toContain('stampotadapeda');
  });

  it('handles a zero-question form (name still in COL$N, email in COL$P)', () => {
    const r = parseColumnarMetaLead({
      'COL$A': '951488531276339',
      'COL$B': '2026-06-28 6:51:48',
      'COL$J': '🧲 SOCIAL MEDIA LEAD FORM (ITDEV)',
      'COL$K': '',
      'COL$L': 'fb',
      'COL$M': '',
      'COL$N': 'Costas Hadjipavlis',
      'COL$O': '35799645690',
      'COL$P': 'elde@cytanet.com.cy',
      'COL$Q': 'El-De Confectionery Ltd',
    });
    expect(r!.fullName).toBe('Costas Hadjipavlis');
    expect(r!.phone).toBe('35799645690');
    expect(r!.email).toBe('elde@cytanet.com.cy');
  });
});
