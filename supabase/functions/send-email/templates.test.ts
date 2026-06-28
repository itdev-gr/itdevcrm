import { describe, it, expect, vi } from 'vitest';

// templates.ts reads Deno.env at module-eval time (APP_BASE) — not only at call
// time — so the stub must exist BEFORE the import. vi.hoisted runs before imports.
vi.hoisted(() => {
  (globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } };
});

import { renderTemplate, renderDbTemplate } from './templates';

describe('email templates', () => {
  it('renders a Greek payment_due_soon email with amount and date', () => {
    const r = renderTemplate('payment_due_soon', {
      client_name: 'Acme', service_type: 'web_seo', amount_gross: 124, due_date: '2026-06-05',
    });
    expect(r.subject).toContain('2026-06-05');
    expect(r.html).toContain('€124.00');
    expect(r.html).toContain('Web SEO');
    expect(r.text.length).toBeGreaterThan(0);
  });

  it('passes through a custom email subject/body', () => {
    const r = renderTemplate('custom', { subject: 'Γεια', html: '<p>Σώμα</p>' });
    expect(r.subject).toBe('Γεια');
    expect(r.html).toContain('Σώμα');
  });

  it('throws on an unknown template', () => {
    expect(() => renderTemplate('nope', {})).toThrow(/Unknown template/);
  });

  it('appends a CTA button when data.cta_url is present', () => {
    const r = renderDbTemplate(
      { subject: 'S', body: 'Hello {{reset_url}}', client_facing: false },
      {
        reset_url: 'https://x.test/verify?a=1&b=2',
        cta_url: 'https://x.test/verify?a=1&b=2',
        cta_label: 'Set new password',
      },
    );
    expect(r.html).toContain('<a href="https://x.test/verify?a=1&amp;b=2"');
    expect(r.html).toContain('Set new password');
    // Plain-text version keeps the raw (unescaped) URL from the body.
    expect(r.text).toContain('https://x.test/verify?a=1&b=2');
  });

  it('renders no CTA button without data.cta_url', () => {
    const r = renderDbTemplate({ subject: 'S', body: 'Hi', client_facing: false }, {});
    expect(r.html).not.toContain('<a href=');
  });

  it('escapes HTML in a custom email body and converts newlines', () => {
    const r = renderTemplate('custom', { subject: 'S', text: 'Hi <script>alert(1)</script>\nsecond line' });
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).toContain('second line');
    expect(r.html).toContain('<br/>');
  });

  it('strips CR/LF from a custom subject (no header injection)', () => {
    const r = renderTemplate('custom', { subject: 'Hi\r\nBcc: evil@x.gr', text: 'body' });
    expect(r.subject).not.toMatch(/[\r\n]/);
  });

  it('escapes user-controlled fields in built-in payment templates', () => {
    const r = renderTemplate('payment_overdue', {
      client_name: '<b>x</b>', service_type: 'web_seo', amount_gross: 10, due_date: '2026-01-01',
    });
    expect(r.html).not.toContain('<b>x</b>');
    expect(r.html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
