// Regex-based HTML → plain text for inbound HTML-only emails (no DOM dependency,
// so it runs the same in Node tests and the browser).
//
// Some captured Gmail messages arrive HTML-only (no text/plain part): the row is
// stored with body_text = '' and the real content in body_html. The Emails tab
// renders plain text (and then runs it through cleanEmailBody), so we distil the
// HTML down to readable text here.
//
// Greek is plain Unicode and passes through untouched — deliberately NO \b
// word-boundary regexes anywhere near it (JS \b is ASCII-only and misbehaves
// after Greek letters; a known gotcha in this codebase).

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Decode entities in a single left-to-right pass so nothing double-decodes
 *  (e.g. `&amp;lt;` stays the literal text `&lt;`). Unknown named entities are
 *  left as-is. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (Number.isNaN(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Best-effort HTML → plain text. Order matters: kill non-content blocks first,
 *  turn block boundaries into newlines, strip the rest of the tags, and only
 *  THEN decode entities (so a decoded `<`/`>` can't be re-read as a tag). */
export function htmlToText(html: string): string {
  if (!html) return '';

  let s = html.replace(/\r\n?/g, '\n');

  // 1. Drop <style>/<script>/<head> blocks together with their content.
  s = s.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '');

  // 2. Drop HTML comments.
  s = s.replace(/<!--[\s\S]*?-->/g, '');

  // 3. Block-level boundaries → newline.
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|blockquote)\s*>/gi, '\n');

  // 4. Strip every remaining tag.
  s = s.replace(/<[^>]*>/g, '');

  // 5. Decode entities.
  s = decodeEntities(s);

  // 6. Collapse 3+ consecutive newlines to 2, then trim.
  return s.replace(/\n{3,}/g, '\n\n').trim();
}
