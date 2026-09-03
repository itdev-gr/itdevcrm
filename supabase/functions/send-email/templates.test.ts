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

  // Safety net for the "{{code}} - subject" pattern every client-facing
  // template uses. Without cleanSubject(), a missing data.code would ship
  // " - Πρόσβαση..." to the recipient (the nikkas1@ incident, 2026-06-30).
  it('strips a leading " - " when {{code}} interpolates to empty', () => {
    const r = renderDbTemplate(
      { subject: '{{code}} - Πρόσβαση στο Google Search Console — ITDev', body: 'b', client_facing: true },
      {},
    );
    expect(r.subject).toBe('Πρόσβαση στο Google Search Console — ITDev');
    expect(r.subject.startsWith('-')).toBe(false);
    expect(r.subject.startsWith(' ')).toBe(false);
  });

  it('renders the webdev weekly report with stats, flags and escaped fields', () => {
    const r = renderTemplate('webdev_weekly_report', {
      week_label: '10 Αυγ – 17 Αυγ 2026',
      overview: 'Καλή εβδομάδα.\n\nΔύο έργα προχώρησαν.',
      attention: ['Πελάτης Χ: κολλημένο <script>'],
      totals: { active: 5, newThisWeek: 1, movedThisWeek: 2, completedThisWeek: 1 },
      projects: [
        {
          code: '000066-WEBDEV-2', client: 'ΑΛΕΞΑΝΔΡΑ <Φ>', stage: 'Ανάπτυξη',
          daysInStage: 12, daysSinceTouch: 3, openTasks: 2, tasksResolvedThisWeek: 1,
          commentsThisWeek: 4, weekNote: 'Σχεδιασμός → Ανάπτυξη', flags: ['stuck'],
        },
      ],
      ai_generated: true,
      test: true,
    });
    expect(r.subject).toContain('[ΔΟΚΙΜΗ]');
    expect(r.subject).toContain('10 Αυγ – 17 Αυγ 2026');
    expect(r.html).toContain('Εβδομαδιαία Αναφορά Web Dev');
    expect(r.html).toContain('000066-WEBDEV-2');
    expect(r.html).toContain('Κολλημένο'); // stuck flag chip label
    expect(r.html).not.toContain('<script>'); // attention text escaped
    expect(r.html).toContain('ΑΛΕΞΑΝΔΡΑ &lt;Φ&gt;');
    expect(r.text).toContain('Σχεδιασμός → Ανάπτυξη');
  });

  it('renders the webdev weekly report empty-board fallback', () => {
    const r = renderTemplate('webdev_weekly_report', {
      week_label: 'w', overview: 'Στάσιμη εβδομάδα.', attention: [], totals: {}, projects: [],
    });
    expect(r.subject.startsWith('[ΔΟΚΙΜΗ]')).toBe(false);
    expect(r.html).toContain('Δεν υπάρχουν ενεργά web dev έργα');
  });

  it('keeps the code prefix intact when data.code is supplied', () => {
    const r = renderDbTemplate(
      { subject: '{{code}} - Καλώς ήρθατε', body: 'b', client_facing: true },
      { code: '005467' },
    );
    expect(r.subject).toBe('005467 - Καλώς ήρθατε');
  });

  it('renders markdown-lite markup from an admin-edited template body', () => {
    const r = renderDbTemplate(
      {
        subject: '{{code}} - Πρόσβαση',
        body: '## 1. Πρόσβαση\n\nΓια τις **βελτιώσεις** σας:\n\n- **Όνομα χρήστη**\n- Κωδικό\n\n**Email:** info@itdev.gr\nhttps://shorturl.at/OqTid',
        client_facing: true,
      },
      { code: '000123' },
    );
    expect(r.subject).toBe('000123 - Πρόσβαση');
    expect(r.html).toContain('<h3 style="font-size:16px;font-weight:700;margin:24px 0 8px;font-family:Arial,sans-serif">1. Πρόσβαση</h3>');
    expect(r.html).toContain('Για τις <strong>βελτιώσεις</strong> σας:');
    expect(r.html).toContain('<li style="margin:4px 0"><strong>Όνομα χρήστη</strong></li>');
    expect(r.html).toContain('<a href="mailto:info@itdev.gr"');
    expect(r.html).toContain('<a href="https://shorturl.at/OqTid"');
    expect(r.html).not.toContain('**');
    expect(r.html).not.toContain('## ');
    // plain-text twin: markers stripped, structure kept, signature appended
    expect(r.text.startsWith('1. Πρόσβαση\n\nΓια τις βελτιώσεις σας:\n\n- Όνομα χρήστη\n- Κωδικό\n\nEmail: info@itdev.gr\nhttps://shorturl.at/OqTid')).toBe(true);
    expect(r.text).toContain('IT DEV');
  });

  it('keeps interpolating {{variables}} before markup rendering', () => {
    const r = renderDbTemplate(
      { subject: 'S', body: 'Γεια **{{name}}**', client_facing: false },
      { name: 'Μαρία' },
    );
    expect(r.html).toContain('<strong>Μαρία</strong>');
    expect(r.text).toBe('Γεια Μαρία');
  });
});

describe('chatgpt_ads_campaign', () => {
  it('prefixes the subject with the lead code', () => {
    const r = renderTemplate('chatgpt_ads_campaign', { code: '000123' });
    expect(r.subject).toBe('000123 - Νέα Υπηρεσία ChatGPT Ads από την ITDEV');
  });

  it('drops the orphan dash when code is missing', () => {
    const r = renderTemplate('chatgpt_ads_campaign', {});
    expect(r.subject).toBe('Νέα Υπηρεσία ChatGPT Ads από την ITDEV');
  });

  it('renders the hero image on top and the campaign copy', () => {
    const r = renderTemplate('chatgpt_ads_campaign', { code: '000123' });
    expect(r.html).toContain('/email-assets/chatgpt-ads-2026.jpg');
    expect(r.html.indexOf('chatgpt-ads-2026.jpg')).toBeLessThan(r.html.indexOf('ChatGPT Ads Starter'));
    expect(r.html).toContain('150€/μήνα + ΦΠΑ');
    expect(r.html).toContain('sales@itdev.gr');
    expect(r.text).toContain('ChatGPT Ads Starter');
  });
});
