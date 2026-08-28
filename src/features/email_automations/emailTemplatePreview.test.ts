import { describe, it, expect } from 'vitest';
import { templatePreviewHtml, templateSupportsMarkup } from './templatePreview';
import { renderEmailMarkup } from '../../../supabase/functions/_shared/emailMarkup.ts';
import { textToHtml } from '../offers/offerEmailBody';

describe('templatePreviewHtml', () => {
  it('is exactly the send-email HTML body for the same markup', () => {
    const body = '## Τίτλος\n\n**Bold** και link https://x.test\n\n- α\n- β';
    expect(templatePreviewHtml(body, 'webseo_gsc_access')).toBe(renderEmailMarkup(body).html);
    expect(templatePreviewHtml(body, 'webseo_gsc_access')).toContain('<strong>Bold</strong>');
    expect(templatePreviewHtml(body, 'webseo_gsc_access')).toContain('<li style="margin:4px 0">α</li>');
  });

  it('falls back to textToHtml (no markup rendering) for offer composer keys', () => {
    const body = 'Γεια σας **Μαρία**,\n\nΕυχαριστούμε.';
    expect(templatePreviewHtml(body, 'offer_email_intro')).toBe(textToHtml(body));
    expect(templatePreviewHtml(body, 'offer_email_intro')).toContain('**');
  });
});

describe('templateSupportsMarkup', () => {
  it('is true for a regular renderer-backed template key', () => {
    expect(templateSupportsMarkup('webseo_gsc_access')).toBe(true);
  });

  it('is false for offer_* and ud_offer_* composer keys', () => {
    expect(templateSupportsMarkup('offer_email_intro')).toBe(false);
    expect(templateSupportsMarkup('ud_offer_email_outro')).toBe(false);
    expect(templateSupportsMarkup('offer_svc_web_seo')).toBe(false);
  });
});
