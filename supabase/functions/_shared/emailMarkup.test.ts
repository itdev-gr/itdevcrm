import { describe, it, expect } from 'vitest';
import { renderEmailMarkup, markupToText } from './emailMarkup';

describe('renderEmailMarkup', () => {
  it('turns blank-line separated blocks into paragraphs and single newlines into <br/>', () => {
    const { html } = renderEmailMarkup('α\nβ\n\nγ');
    expect(html).toBe('<p style="margin:0 0 12px">α<br/>β</p><p style="margin:0 0 12px">γ</p>');
  });

  it('renders **bold** inline as <strong>', () => {
    const { html } = renderEmailMarkup('Για τις **τεχνικές βελτιώσεις** σας.');
    expect(html).toContain('Για τις <strong>τεχνικές βελτιώσεις</strong> σας.');
    expect(html).not.toContain('**');
  });

  it('renders a "## " line as an h3 heading', () => {
    const { html } = renderEmailMarkup('## 1. Πρόσβαση στη διαχείριση\n\nκείμενο');
    expect(html).toContain('<h3 style="font-size:16px;font-weight:700;margin:24px 0 8px">1. Πρόσβαση στη διαχείριση</h3>');
    expect(html).toContain('<p style="margin:0 0 12px">κείμενο</p>');
  });

  it('renders a block of "- " lines as a bullet list with inline bold', () => {
    const { html } = renderEmailMarkup('- **Όνομα χρήστη**\n- Ιδανικά, **πλήρη δικαιώματα**');
    expect(html).toBe(
      '<ul style="margin:0 0 12px 20px;padding:0">' +
        '<li style="margin:4px 0"><strong>Όνομα χρήστη</strong></li>' +
        '<li style="margin:4px 0">Ιδανικά, <strong>πλήρη δικαιώματα</strong></li>' +
        '</ul>',
    );
  });

  it('links bare URLs and e-mail addresses (mailto), bold wrapping a link works', () => {
    const { html } = renderEmailMarkup('https://shorturl.at/OqTid\n**info@itdev.gr**\n**Email:** pefstathiadis@itdev.gr');
    expect(html).toContain('<a href="https://shorturl.at/OqTid" style="color:#2563eb;text-decoration:underline">https://shorturl.at/OqTid</a>');
    expect(html).toContain('<strong><a href="mailto:info@itdev.gr" style="color:#2563eb;text-decoration:underline">info@itdev.gr</a></strong>');
    expect(html).toContain('<strong>Email:</strong> <a href="mailto:pefstathiadis@itdev.gr"');
  });

  it('does not double-link an e-mail that is part of a URL', () => {
    const { html } = renderEmailMarkup('https://x.test/?u=a@b.co');
    expect(html.match(/<a /g)?.length).toBe(1);
  });

  it('escapes HTML before applying markup', () => {
    const { html } = renderEmailMarkup('**<script>alert(1)</script>** & "q"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong> &amp; &quot;q&quot;');
  });

  it('leaves a body without markup unchanged apart from paragraphs (backwards compatible)', () => {
    const { html, text } = renderEmailMarkup('Καλησπέρα σας,\nΠαρακάτω οδηγίες.\n\nΕυχαριστούμε.');
    expect(html).toBe('<p style="margin:0 0 12px">Καλησπέρα σας,<br/>Παρακάτω οδηγίες.</p><p style="margin:0 0 12px">Ευχαριστούμε.</p>');
    expect(text).toBe('Καλησπέρα σας,\nΠαρακάτω οδηγίες.\n\nΕυχαριστούμε.');
  });

  it('returns empty html/text for a blank body', () => {
    expect(renderEmailMarkup('   \n\n ')).toEqual({ html: '', text: '' });
  });
});

describe('markupToText', () => {
  it('strips ** and "## " but keeps bullets, links and blank lines', () => {
    expect(markupToText('## Τίτλος\n\n**Bold** κείμενο\n- **α**\n- β\n\nhttps://x.test'))
      .toBe('Τίτλος\n\nBold κείμενο\n- α\n- β\n\nhttps://x.test');
  });
});
