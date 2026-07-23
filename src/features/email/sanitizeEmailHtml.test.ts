import { describe, it, expect } from 'vitest';
import { sanitizeEmailHtml } from './sanitizeEmailHtml';

describe('sanitizeEmailHtml', () => {
  it('keeps allowed formatting', () => {
    const html =
      '<p>Hi <strong>bold</strong> <em>it</em> <u>u</u> <span style="color:#e11d48">red</span></p><ul><li>a</li></ul>';
    const out = sanitizeEmailHtml(html);
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('color:');
    expect(out).toContain('<li>a</li>');
  });
  it('strips scripts, event handlers, and disallowed tags', () => {
    const out = sanitizeEmailHtml('<p onclick="x()">hi</p><script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
  });
  it('drops non-color inline styles', () => {
    const out = sanitizeEmailHtml('<span style="color:red;position:fixed;background:url(x)">t</span>');
    expect(out).toContain('color:red');
    expect(out).not.toContain('position');
    expect(out).not.toContain('background');
  });
  it('forces safe link attributes and blocks javascript: hrefs', () => {
    expect(sanitizeEmailHtml('<a href="https://x.gr">l</a>')).toContain('rel="noopener noreferrer"');
    expect(sanitizeEmailHtml('<a href="https://x.gr">l</a>')).toContain('target="_blank"');
    expect(sanitizeEmailHtml('<a href="javascript:alert(1)">l</a>')).not.toContain('javascript:');
  });
  it('preserves Greek text', () => {
    expect(sanitizeEmailHtml('<p>Καλημέρα <strong>κόσμε</strong></p>')).toContain('Καλημέρα');
  });
  it('strips attributes outside the allowlist (data-*/aria-*/id/class/title)', () => {
    const out = sanitizeEmailHtml(
      '<span data-x="1" aria-label="spoof" id="a" class="b" title="t">t</span>',
    );
    expect(out).not.toContain('data-x');
    expect(out).not.toContain('aria-label');
    expect(out).not.toContain('id=');
    expect(out).not.toContain('class=');
    expect(out).not.toContain('title=');
    expect(out).toContain('t</span>');
  });
});
