import { describe, it, expect } from 'vitest';
import { interpolate, textToHtml, buildOfferEmail, type OfferEmailVars } from './offerEmailBody';

const vars: OfferEmailVars = {
  name: 'Κώστας',
  code: '007005',
  owner_name: 'Μάριος',
  offer_number: 'OFR-202608-0042',
  validity_days: 14,
  offer_url: 'https://www.itdevcrm.com/o/6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8',
};

describe('interpolate (parity with send-email templates.ts)', () => {
  it('substitutes {{key}}, tolerating inner whitespace', () => {
    expect(interpolate('Γεια {{name}} — {{ offer_number }}!', vars)).toBe('Γεια Κώστας — OFR-202608-0042!');
  });

  it('renders unknown keys as empty string, like the server', () => {
    expect(interpolate('a{{missing}}b', vars)).toBe('ab');
  });

  it('stringifies numbers', () => {
    expect(interpolate('{{validity_days}} ημέρες', vars)).toBe('14 ημέρες');
  });
});

describe('textToHtml', () => {
  it('splits blank-line blocks into <p> and single newlines into <br>', () => {
    expect(textToHtml('α\nβ\n\nγ')).toBe('<p>α<br>β</p><p>γ</p>');
  });

  it('escapes HTML in the template text', () => {
    expect(textToHtml('1 < 2 & "x"')).toBe('<p>1 &lt; 2 &amp; &quot;x&quot;</p>');
  });

  it('turns a bare URL into a link (so {{offer_url}} is clickable)', () => {
    expect(textToHtml('Δείτε εδώ:\nhttps://www.itdevcrm.com/o/abc-123')).toBe(
      '<p>Δείτε εδώ:<br><a href="https://www.itdevcrm.com/o/abc-123">https://www.itdevcrm.com/o/abc-123</a></p>',
    );
  });

  it('links a URL inside a sentence without swallowing trailing text', () => {
    expect(textToHtml('Πατήστε https://example.com/x και μετά απαντήστε.')).toBe(
      '<p>Πατήστε <a href="https://example.com/x">https://example.com/x</a> και μετά απαντήστε.</p>',
    );
  });

  it('leaves URL-free text unchanged and never double-escapes', () => {
    expect(textToHtml('Χωρίς σύνδεσμο & τέλος')).toBe('<p>Χωρίς σύνδεσμο &amp; τέλος</p>');
  });
});

describe('buildOfferEmail', () => {
  const intro = { key: 'offer_email_intro', subject: 'Προσφορά {{offer_number}}', body: 'Αγαπητέ/ή {{name}},\n\nη προσφορά: {{offer_url}}' };
  const outro = { key: 'offer_email_outro', subject: 'x', body: 'Παραμένουμε στη διάθεσή σας.' };

  it('assembles subject from the intro and body as intro → outro with the link rendered', () => {
    const { subject, html } = buildOfferEmail({ intro, outro, vars });
    expect(subject).toBe('Προσφορά OFR-202608-0042');
    const idx = (s: string) => html.indexOf(s);
    expect(idx('Αγαπητέ/ή Κώστας')).toBeGreaterThanOrEqual(0);
    expect(html).toContain(`<a href="${vars.offer_url}">`);
    expect(idx('Αγαπητέ/ή Κώστας')).toBeLessThan(idx('Παραμένουμε στη διάθεσή σας.'));
  });
});

describe('UD subject format (ΡΟΗ_ΝΕΟΥ_LEAD)', () => {
  it('interpolates name and lead code in the owner subject format', () => {
    expect(interpolate('ITDEV Προσφορά | {{name}} ({{code}})', vars)).toBe(
      'ITDEV Προσφορά | Κώστας (007005)',
    );
  });
});
