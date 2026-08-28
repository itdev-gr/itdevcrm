import { describe, it, expect } from 'vitest';
import { interpolate, textToHtml, buildServiceBlockHtml, buildOfferEmail, type OfferEmailVars } from './offerEmailBody';

const vars: OfferEmailVars = {
  name: 'Κώστας',
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

describe('buildServiceBlockHtml / buildOfferEmail', () => {
  const intro = { key: 'offer_email_intro', subject: 'Προσφορά {{offer_number}}', body: 'Αγαπητέ/ή {{name}},\n\nσυνημμένη η προσφορά.' };
  const outro = { key: 'offer_email_outro', subject: 'x', body: 'Με εκτίμηση,\n{{owner_name}}' };
  const svc = { key: 'offer_svc_local_seo', subject: 'Local SEO', body: 'Τοπική προώθηση.' };
  const svc2 = { key: 'offer_svc_web_dev', subject: 'Κατασκευή', body: 'Ιστοσελίδες.' };

  it('renders a bold <p><strong> heading (no <h*> — sanitizer allowlist)', () => {
    const html = buildServiceBlockHtml(svc, vars);
    expect(html).toBe('<p><strong>Local SEO</strong></p><p>Τοπική προώθηση.</p>');
    expect(html).not.toMatch(/<h\d/);
  });

  it('assembles subject from intro and body as intro → services (in order) → outro', () => {
    const { subject, html } = buildOfferEmail({ intro, outro, serviceTpls: [svc, svc2], vars });
    expect(subject).toBe('Προσφορά OFR-202608-0042');
    const idx = (s: string) => html.indexOf(s);
    expect(idx('Αγαπητέ/ή Κώστας')).toBeGreaterThanOrEqual(0);
    expect(idx('Αγαπητέ/ή Κώστας')).toBeLessThan(idx('Local SEO'));
    expect(idx('Local SEO')).toBeLessThan(idx('Κατασκευή'));
    expect(idx('Κατασκευή')).toBeLessThan(idx('Με εκτίμηση,<br>Μάριος'));
  });
});
