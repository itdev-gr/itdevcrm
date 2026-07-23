import DOMPurify from 'dompurify';

const ALLOWED_TAGS = ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'span', 'div'];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'style'];

// Keep only `color:` declarations in any style attribute (drops position/background/etc.).
function keepColorOnly(style: string): string {
  return style
    .split(';')
    .map((d) => d.trim())
    .filter((d) => /^color\s*:/i.test(d))
    .join('; ');
}

let hooked = false;
function ensureHooks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node instanceof Element) {
      if (node.hasAttribute('style')) {
        const kept = keepColorOnly(node.getAttribute('style') ?? '');
        if (kept) node.setAttribute('style', kept);
        else node.removeAttribute('style');
      }
      if (node.tagName === 'A') {
        node.setAttribute('rel', 'noopener noreferrer');
        node.setAttribute('target', '_blank');
      }
    }
  });
}

/** Sanitise author HTML for outgoing email: allowlisted formatting tags,
 *  color-only inline styles, safe http/https/mailto links with rel/target. */
export function sanitizeEmailHtml(html: string): string {
  ensureHooks();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });
}
