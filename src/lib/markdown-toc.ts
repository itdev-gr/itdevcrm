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
