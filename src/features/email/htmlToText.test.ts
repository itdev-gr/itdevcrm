import { describe, it, expect } from 'vitest';
import { htmlToText } from './htmlToText';

describe('htmlToText', () => {
  it('renders a realistic HTML-only email (divs + br + entities + Greek)', () => {
    const html =
      '<div dir="ltr">Καλημέρα, οι φωτογραφίες ανέβηκαν.<br>Ευχαριστούμε &amp; καλή συνέχεια.</div>' +
      '<div>Τηλ: 210&nbsp;1234567</div>';
    expect(htmlToText(html)).toBe(
      'Καλημέρα, οι φωτογραφίες ανέβηκαν.\nΕυχαριστούμε & καλή συνέχεια.\nΤηλ: 210 1234567',
    );
  });

  it('strips <style>, <script> and <head> blocks with their content', () => {
    const html =
      '<head><title>x</title></head>' +
      '<style>.a{color:red}</style>' +
      '<p>Hello</p>' +
      '<script>alert(1)</script>' +
      '<p>World</p>';
    const out = htmlToText(html);
    expect(out).toBe('Hello\nWorld');
    expect(out).not.toMatch(/color:red/);
    expect(out).not.toMatch(/alert/);
  });

  it('decodes decimal, hex and named entities after stripping tags', () => {
    // &lt;tag&gt; must survive as literal text, not be treated as a real tag.
    expect(htmlToText('<p>It&#39;s 5&#8364; &lt;tag&gt; &#x41;</p>')).toBe("It's 5€ <tag> A");
  });

  it('leaves plain text without tags unchanged', () => {
    const text = 'Καλημέρα, οι φωτογραφίες ανέβηκαν χωρίς κανένα tag εδώ.';
    expect(htmlToText(text)).toBe(text);
  });

  it('collapses 3+ consecutive newlines to 2 and trims', () => {
    expect(htmlToText('<p>A</p><br><br><br><p>B</p>')).toBe('A\n\nB');
  });

  it('returns an empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });

  it('converts block-level closers (li, tr, h2, blockquote) to newlines', () => {
    const html =
      '<h2>Τίτλος</h2><ul><li>Ένα</li><li>Δύο</li></ul>' +
      '<blockquote>Παράθεση</blockquote>';
    expect(htmlToText(html)).toBe('Τίτλος\nΈνα\nΔύο\nΠαράθεση');
  });
});
