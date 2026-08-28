import { describe, it, expect } from 'vitest';
import { templatePreviewHtml } from './templatePreview';
import { renderEmailMarkup } from '../../../supabase/functions/_shared/emailMarkup.ts';

describe('templatePreviewHtml', () => {
  it('is exactly the send-email HTML body for the same markup', () => {
    const body = '## Τίτλος\n\n**Bold** και link https://x.test\n\n- α\n- β';
    expect(templatePreviewHtml(body)).toBe(renderEmailMarkup(body).html);
    expect(templatePreviewHtml(body)).toContain('<strong>Bold</strong>');
    expect(templatePreviewHtml(body)).toContain('<li style="margin:4px 0">α</li>');
  });
});
