import { describe, it, expect } from 'vitest';
import { DOC_AREAS, loadDoc, allDocFiles, globbedFiles } from './docIndex';

describe('docIndex', () => {
  it('every indexed doc resolves to a real file', () => {
    for (const f of allDocFiles()) expect(loadDoc(f), `missing ${f}`).toBeTruthy();
  });

  it('has no orphan markdown files (every globbed file is indexed)', () => {
    const indexed = new Set(allDocFiles());
    for (const f of globbedFiles()) expect(indexed.has(f), `orphan ${f}`).toBe(true);
  });

  it('slugs are unique within an area', () => {
    for (const a of DOC_AREAS) {
      const slugs = a.docs.map((d) => d.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });
});
