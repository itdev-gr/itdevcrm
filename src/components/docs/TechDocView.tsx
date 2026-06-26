import { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { extractToc, splitDocIntoBlocks } from '@/lib/markdown-toc';
import { MermaidDiagram } from './MermaidDiagram';

const components = {
  h1: (p: React.ComponentProps<'h1'>) => (
    <h1 className="mb-4 text-2xl font-bold tracking-tight" {...p} />
  ),
  p: (p: React.ComponentProps<'p'>) => <p className="my-3 text-sm leading-7 text-foreground" {...p} />,
  ul: (p: React.ComponentProps<'ul'>) => (
    <ul className="my-3 list-disc space-y-1.5 pl-6 text-sm text-foreground" {...p} />
  ),
  ol: (p: React.ComponentProps<'ol'>) => (
    <ol className="my-3 list-decimal space-y-1.5 pl-6 text-sm text-foreground" {...p} />
  ),
  li: (p: React.ComponentProps<'li'>) => <li className="leading-7" {...p} />,
  a: (p: React.ComponentProps<'a'>) => (
    <a
      className="font-medium text-[#157777] underline-offset-2 hover:underline dark:text-[#7ad4d4]"
      {...p}
    />
  ),
  table: (p: React.ComponentProps<'table'>) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full border-collapse text-sm" {...p} />
    </div>
  ),
  thead: (p: React.ComponentProps<'thead'>) => <thead className="bg-muted/60 text-left" {...p} />,
  th: (p: React.ComponentProps<'th'>) => (
    <th className="border-b border-border/60 px-3 py-2.5 font-semibold text-muted-foreground" {...p} />
  ),
  td: (p: React.ComponentProps<'td'>) => (
    <td className="border-b border-border/50 px-3 py-2.5 align-top text-foreground" {...p} />
  ),
  code: (p: React.ComponentProps<'code'>) => (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]" {...p} />
  ),
  pre: ({ children, ...rest }: React.ComponentProps<'pre'>) => {
    const child = Array.isArray(children) ? children[0] : children;
    const cn = (child as { props?: { className?: string } } | undefined)?.props?.className ?? '';
    if (cn.includes('language-mermaid')) {
      const chart = String((child as { props: { children: unknown } }).props.children).trim();
      return <MermaidDiagram chart={chart} />;
    }
    return (
      <pre
        className="my-4 overflow-x-auto rounded-lg border border-border/60 bg-muted/50 p-4 text-xs leading-6"
        {...rest}
      >
        {children}
      </pre>
    );
  },
};

/** Renders one technical doc (raw markdown) with anchored headings + Mermaid diagrams. */
export function TechDocView({ markdown }: { markdown: string }) {
  const toc = useMemo(() => extractToc(markdown), [markdown]);
  const blocks = useMemo(() => splitDocIntoBlocks(markdown, toc), [markdown, toc]);
  return (
    <article className="min-w-0 rounded-xl border border-border/60 bg-card p-6 shadow-sm sm:p-8">
      {blocks.map((block, i) =>
        block.type === 'heading' ? (
          block.level === 2 ? (
            <h2
              key={block.id}
              id={block.id}
              className="scroll-mt-24 border-b border-border/60 pb-2 pt-4 text-xl font-semibold first:pt-0"
            >
              {block.text}
            </h2>
          ) : (
            <h3 key={block.id} id={block.id} className="scroll-mt-24 pt-4 text-base font-semibold">
              {block.text}
            </h3>
          )
        ) : (
          <Markdown key={`md-${i}`} remarkPlugins={[remarkGfm]} components={components}>
            {block.content}
          </Markdown>
        ),
      )}
    </article>
  );
}
