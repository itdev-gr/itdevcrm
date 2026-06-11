import { describe, it, expect } from 'vitest';
import { renderTemplate, renderDbTemplate } from './templates';

// renderDbTemplate reads Deno.env at call time; stub it for the Node test runtime.
Object.assign(globalThis, { Deno: { env: { get: () => undefined } } });

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
});
