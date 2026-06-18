import type { ReactNode } from 'react';

export type TocItem = {
  id: string;
  text: string;
  level: 2 | 3;
};

export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[*_`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
}

/** Stable heading ids in document order — shared by sidebar links and rendered headings. */
export function headingIdsFromMarkdown(markdown: string): string[] {
  return extractToc(markdown).map((item) => item.id);
}

export type DocBlock =
  | { type: 'markdown'; content: string }
  | { type: 'heading'; level: 2 | 3; text: string; id: string };

/** Split markdown into prose blocks and headings with ids aligned to extractToc order. */
export function splitDocIntoBlocks(markdown: string, toc: TocItem[]): DocBlock[] {
  const blocks: DocBlock[] = [];
  let tocIndex = 0;
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (content) blocks.push({ type: 'markdown', content });
    buffer = [];
  };

  for (const line of markdown.split('\n')) {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (match && tocIndex < toc.length) {
      const level = match[1]!.length as 2 | 3;
      const item = toc[tocIndex];
      if (item && item.level === level) {
        flush();
        blocks.push({ type: 'heading', level: item.level, text: item.text, id: item.id });
        tocIndex += 1;
        continue;
      }
    }
    buffer.push(line);
  }

  flush();
  return blocks;
}

/** Pull `##` / `###` headings out of raw markdown for the docs sidebar. */
export function extractToc(markdown: string): TocItem[] {
  const seen = new Map<string, number>();
  const items: TocItem[] = [];

  for (const line of markdown.split('\n')) {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (!match) continue;

    const level = match[1]!.length as 2 | 3;
    const text = match[2]!.replace(/\*\*/g, '').replace(/`/g, '').trim();
    let base = slugifyHeading(text);
    if (!base) base = `section-${items.length + 1}`;

    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count + 1}`;

    items.push({ id, text, level });
  }

  return items;
}

export function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return nodeText((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}
