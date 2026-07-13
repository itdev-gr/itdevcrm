import { describe, it, expect } from 'vitest';
import {
  renderSignatureHtml,
  renderSignatureText,
  SIGNATURE_COMPANY,
} from '../../../supabase/functions/_shared/signature.ts';

const LOGO = 'https://www.itdevcrm.com/email-assets/itdev-logo-round.png';

describe('renderSignatureHtml — company variant (default)', () => {
  const html = renderSignatureHtml(LOGO);
  it('contains greeting, company block, fixed rows and logo', () => {
    expect(html).toContain('Με εκτίμηση,');
    expect(html).toContain('IT DEV');
    expect(html).toContain('Digital Marketing Agency');
    expect(html).toContain('Tel.: +30 210 260 3414');
    expect(html).toContain('A.: Argous 139, Athens, 104 41');
    expect(html).toContain('mailto:info@itdev.gr');
    expect(html).toContain('href="https://www.itdev.gr"');
    expect(html).toContain(`src="${LOGO}"`);
  });
  it('contains both disclaimer paragraphs with bold labels', () => {
    expect(html).toContain('<b>ΑΠΟΠΟΙΗΣΗ ΕΥΘΥΝΗΣ:</b>');
    expect(html).toContain('εμπιστευτικό και προορίζεται αποκλειστικά');
    expect(html).toContain('<b>Επιπλέον σημείωση:</b>');
    expect(html).toContain('αποστολή γραπτού αιτήματος μέσω email');
  });
});

describe('renderSignatureHtml — personal variant', () => {
  it('uses the person fields', () => {
    const html = renderSignatureHtml(LOGO, {
      name: 'Maria Kifokeri', title: 'Sales Executive',
      phone: '+30 694 000 0000', email: 'mkifokeris@itdev.gr',
    });
    expect(html).toContain('Maria Kifokeri');
    expect(html).toContain('Sales Executive');
    expect(html).toContain('Tel.: +30 694 000 0000');
    expect(html).toContain('mailto:mkifokeris@itdev.gr');
    // fixed rows stay fixed
    expect(html).toContain('A.: Argous 139, Athens, 104 41');
    expect(html).toContain('www.itdev.gr');
  });
  it('omits title and phone rows when empty', () => {
    const html = renderSignatureHtml(LOGO, { name: 'X Y', title: null, phone: null, email: 'x@itdev.gr' });
    expect(html).not.toContain('Tel.:');
    expect(html).not.toContain('color:#2563eb">null');
    expect(html).not.toContain('>null<');
  });
  it('escapes HTML in person fields', () => {
    const html = renderSignatureHtml(LOGO, { name: '<script>x</script>', email: 'a@b.gr' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderSignatureText', () => {
  it('renders company plain text with disclaimers', () => {
    const text = renderSignatureText();
    expect(text).toContain('Με εκτίμηση,');
    expect(text).toContain('IT DEV');
    expect(text).toContain('Tel.: +30 210 260 3414');
    expect(text).toContain('ΑΠΟΠΟΙΗΣΗ ΕΥΘΥΝΗΣ:');
    expect(text).not.toContain('<');
  });
});

describe('SIGNATURE_COMPANY', () => {
  it('is the fixed company block', () => {
    expect(SIGNATURE_COMPANY).toEqual({
      name: 'IT DEV', title: 'Digital Marketing Agency',
      phone: '+30 210 260 3414', email: 'info@itdev.gr',
    });
  });
});

describe('renderSignatureHtml — logoUrl escaping', () => {
  it('escapes a hostile logoUrl instead of letting it break out of src', () => {
    const html = renderSignatureHtml('https://x/a.png" onerror="alert(1)');
    expect(html).not.toContain('" onerror="');
    expect(html).toContain('src="https://x/a.png&quot; onerror=&quot;alert(1)"');
  });
});
