// Markdown-lite renderer for admin-editable email_templates bodies — the
// single source of truth for BOTH the send-email edge function (Deno) and the
// admin preview in EmailAutomationsPage (Vite/vitest). Keep this file
// dependency-free and free of Deno/browser globals so both runtimes import it.
//
// Supported markup (everything else is literal text, HTML-escaped):
//   blank line          → paragraph break
//   "## Heading"        → <h3>
//   "- item" lines      → <ul><li> (a block where every line starts with "- ")
//   **bold**            → <strong>
//   http(s)://… / a@b.c → clickable links (mailto for e-mail addresses)
// {{variables}} are interpolated by the caller BEFORE rendering.

const P_STYLE = 'margin:0 0 12px';
const H_STYLE = 'font-size:16px;font-weight:700;margin:24px 0 8px';
const UL_STYLE = 'margin:0 0 12px 20px;padding:0';
const LI_STYLE = 'margin:4px 0';
const A_STYLE = 'color:#2563eb;text-decoration:underline';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// URL links first, then e-mails that are NOT inside an <a …> we just made
// (split on anchors so "https://x/?u=a@b.co" is linked once), then bold.
function inline(escaped: string): string {
  const withUrls = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" style="${A_STYLE}">${url}</a>`,
  );
  const withMail = withUrls
    .split(/(<a [^>]*>[^<]*<\/a>)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(
            /([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g,
            (mail) => `<a href="mailto:${mail}" style="${A_STYLE}">${mail}</a>`,
          ),
    )
    .join('');
  return withMail.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
}

function renderBlock(block: string): string {
  const lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  if (lines.length === 0) return '';
  if (lines.every((l) => l.startsWith('- '))) {
    const items = lines.map((l) => `<li style="${LI_STYLE}">${inline(escapeHtml(l.slice(2).trim()))}</li>`);
    return `<ul style="${UL_STYLE}">${items.join('')}</ul>`;
  }
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p style="${P_STYLE}">${para.map((l) => inline(escapeHtml(l))).join('<br/>')}</p>`);
    para = [];
  };
  for (const line of lines) {
    if (line.startsWith('## ')) {
      flush();
      out.push(`<h3 style="${H_STYLE}">${inline(escapeHtml(line.slice(3).trim()))}</h3>`);
    } else {
      para.push(line);
    }
  }
  flush();
  return out.join('');
}

/** Plain-text twin of the HTML: markup markers removed, structure kept. */
export function markupToText(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/^## /, '').replace(/\*\*([^*\n]+?)\*\*/g, '$1'))
    .join('\n')
    .trim();
}

export function renderEmailMarkup(text: string): { html: string; text: string } {
  const html = text
    .split(/\n\s*\n/)
    .map(renderBlock)
    .filter(Boolean)
    .join('');
  return { html, text: markupToText(text) };
}
