import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { extractToc, type TocItem } from '@/lib/markdown-toc';

const DOCS = import.meta.glob('../../../docs/boards/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function docForSlug(slug: string): string | null {
  const entry = Object.entries(DOCS).find(([path]) => path.endsWith(`/boards/${slug}.md`));
  return entry?.[1] ?? null;
}

function getScrollRoot(): HTMLElement | null {
  return document.querySelector('main');
}

function scrollToDocSection(id: string, behavior: ScrollBehavior = 'smooth') {
  const target = document.getElementById(id);
  if (!target) return;

  const root = getScrollRoot();
  if (root instanceof HTMLElement) {
    const scrollMargin = parseFloat(getComputedStyle(target).scrollMarginTop) || 96;
    const top =
      target.getBoundingClientRect().top -
      root.getBoundingClientRect().top +
      root.scrollTop -
      scrollMargin;
    root.scrollTo({ top: Math.max(0, top), behavior });
  } else {
    target.scrollIntoView({ behavior, block: 'start' });
  }

  history.replaceState(null, '', `#${id}`);
}

function DocsSidebar({
  items,
  activeId,
  onSelect,
}: {
  items: TocItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation('common');

  if (items.length === 0) return null;

  return (
    <aside className="hidden w-60 shrink-0 lg:block">
      <nav
        aria-label={t('docs.toc_label')}
        className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-border/60 bg-card p-4 shadow-sm"
      >
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {t('docs.toc_label')}
        </p>
        <ul className="space-y-0.5">
          {items.map((item) => {
            const isActive = activeId === item.id;
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onSelect(item.id);
                  }}
                  aria-current={isActive ? 'location' : undefined}
                  className={cn(
                    'block rounded-lg px-3 py-1.5 text-sm transition-colors',
                    item.level === 3 && 'pl-5 text-xs',
                    isActive
                      ? 'bg-primary/10 font-medium text-primary ring-1 ring-primary/25'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {item.text}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

function DocsMobileToc({ items, onSelect }: { items: TocItem[]; onSelect: (id: string) => void }) {
  const { t } = useTranslation('common');

  if (items.length === 0) return null;

  return (
    <div className="mb-6 lg:hidden">
      <label htmlFor="docs-toc" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('docs.toc_label')}
      </label>
      <select
        id="docs-toc"
        className="h-10 w-full rounded-lg border border-input/80 bg-background px-3 text-sm shadow-sm"
        defaultValue=""
        onChange={(e) => {
          const id = e.target.value;
          if (!id) return;
          onSelect(id);
          e.currentTarget.value = '';
        }}
      >
        <option value="">{t('docs.toc_jump')}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.level === 3 ? `— ${item.text}` : item.text}
          </option>
        ))}
      </select>
    </div>
  );
}

export function BoardDocView({ slug }: { slug: string }) {
  const doc = docForSlug(slug);
  const toc = useMemo(() => (doc ? extractToc(doc) : []), [doc]);
  const headingIndexRef = useRef(0);
  const [activeId, setActiveId] = useState<string | null>(null);

  function takeHeadingId() {
    const id = toc[headingIndexRef.current]?.id;
    headingIndexRef.current += 1;
    return id ?? `section-${headingIndexRef.current}`;
  }

  useEffect(() => {
    if (!doc || toc.length === 0) return;

    const hash = window.location.hash.replace(/^#/, '');
    if (hash && toc.some((item) => item.id === hash)) {
      const timer = window.setTimeout(() => scrollToDocSection(hash, 'instant'), 0);
      setActiveId(hash);
      return () => window.clearTimeout(timer);
    }
  }, [doc, toc]);

  useEffect(() => {
    if (toc.length === 0) return;

    const root = getScrollRoot();
    if (!(root instanceof HTMLElement)) return;

    let observer: IntersectionObserver | undefined;
    const frame = requestAnimationFrame(() => {
      const headings = toc
        .map((item) => document.getElementById(item.id))
        .filter((el): el is HTMLElement => el != null);
      if (headings.length === 0) return;

      observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
          const top = visible[0]?.target.id;
          if (top) setActiveId(top);
        },
        {
          root,
          rootMargin: '-20% 0px -65% 0px',
          threshold: [0, 0.1, 0.5, 1],
        },
      );

      for (const heading of headings) observer.observe(heading);
    });

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [doc, toc]);

  if (!doc) {
    return <div className="p-8 text-sm text-muted-foreground">No documentation for this board yet.</div>;
  }

  headingIndexRef.current = 0;

  function handleSelect(id: string) {
    scrollToDocSection(id);
    setActiveId(id);
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl gap-8">
        <DocsSidebar items={toc} activeId={activeId} onSelect={handleSelect} />
        <div className="min-w-0 flex-1">
          <DocsMobileToc items={toc} onSelect={handleSelect} />
          <article className="rounded-xl border border-border/60 bg-card p-6 shadow-sm sm:p-8">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: (p) => <h1 className="mb-4 text-3xl font-bold tracking-tight" {...p} />,
                h2: ({ children, ...p }) => {
                  const id = takeHeadingId();
                  return (
                    <h2
                      id={id}
                      className="scroll-mt-24 border-b border-border/60 pb-2 pt-2 text-xl font-semibold first:pt-0"
                      {...p}
                    >
                      {children}
                    </h2>
                  );
                },
                h3: ({ children, ...p }) => {
                  const id = takeHeadingId();
                  return (
                    <h3 id={id} className="scroll-mt-24 pt-4 text-base font-semibold" {...p}>
                      {children}
                    </h3>
                  );
                },
                p: (p) => <p className="my-3 text-sm leading-7 text-foreground" {...p} />,
                ul: (p) => (
                  <ul className="my-3 list-disc space-y-1.5 pl-6 text-sm text-foreground" {...p} />
                ),
                ol: (p) => (
                  <ol className="my-3 list-decimal space-y-1.5 pl-6 text-sm text-foreground" {...p} />
                ),
                li: (p) => <li className="leading-7" {...p} />,
                a: (p) => (
                  <a
                    className="font-medium text-[#157777] underline-offset-2 hover:underline dark:text-[#7ad4d4]"
                    {...p}
                  />
                ),
                table: (p) => (
                  <div className="my-4 overflow-x-auto rounded-lg border border-border/60">
                    <table className="w-full border-collapse text-sm" {...p} />
                  </div>
                ),
                thead: (p) => <thead className="bg-muted/60 text-left" {...p} />,
                th: (p) => (
                  <th className="border-b border-border/60 px-3 py-2.5 font-semibold text-muted-foreground" {...p} />
                ),
                td: (p) => <td className="border-b border-border/50 px-3 py-2.5 align-top text-foreground" {...p} />,
                code: (p) => (
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]" {...p} />
                ),
                pre: (p) => (
                  <pre
                    className="my-4 overflow-x-auto rounded-lg border border-border/60 bg-muted/50 p-4 text-xs leading-6"
                    {...p}
                  />
                ),
              }}
            >
              {doc}
            </Markdown>
          </article>
        </div>
      </div>
    </div>
  );
}
