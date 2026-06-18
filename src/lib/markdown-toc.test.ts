import { describe, it, expect } from 'vitest';
import { extractToc, headingIdsFromMarkdown, splitDocIntoBlocks } from '@/lib/markdown-toc';

describe('extractToc', () => {
  it('extracts h2/h3 headings with stable ids', () => {
    const md = `# Title\n\n## Where it lives\n\n### Sub\n\n## Payments & invoicing\n`;
    expect(extractToc(md)).toEqual([
      { id: 'where-it-lives', text: 'Where it lives', level: 2 },
      { id: 'sub', text: 'Sub', level: 3 },
      { id: 'payments-invoicing', text: 'Payments & invoicing', level: 2 },
    ]);
  });

  it('returns ids in document order for rendered headings', () => {
    const md = `# Title\n\n## The onboarding board\n\n## Payments & invoicing\n`;
    expect(headingIdsFromMarkdown(md)).toEqual(['the-onboarding-board', 'payments-invoicing']);
  });

  it('splits markdown into prose and heading blocks with stable ids', () => {
    const md = `# Title\n\nIntro line.\n\n## Where it lives\n\nBody.\n\n### Sub\n\nMore.`;
    const toc = extractToc(md);
    expect(splitDocIntoBlocks(md, toc)).toEqual([
      { type: 'markdown', content: '# Title\n\nIntro line.' },
      { type: 'heading', level: 2, text: 'Where it lives', id: 'where-it-lives' },
      { type: 'markdown', content: 'Body.' },
      { type: 'heading', level: 3, text: 'Sub', id: 'sub' },
      { type: 'markdown', content: 'More.' },
    ]);
  });
});
