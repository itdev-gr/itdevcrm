import { useParams } from 'react-router-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Single source of truth: the markdown docs in docs/boards/. The URL slug
// matches the filename (/tech/local-seo/docs → docs/boards/local-seo.md).
const DOCS = import.meta.glob('../../../docs/boards/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function docForSlug(slug: string): string | null {
  const entry = Object.entries(DOCS).find(([path]) => path.endsWith(`/boards/${slug}.md`));
  return entry?.[1] ?? null;
}

export function TechBoardDocsPage() {
  const { serviceType = '' } = useParams<{ serviceType: string }>();
  const doc = docForSlug(serviceType);

  if (!doc) {
    return <div className="p-8 text-sm text-slate-600">No documentation for this board yet.</div>;
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="mb-4 text-2xl font-bold" {...p} />,
          h2: (p) => <h2 className="mb-3 mt-8 border-b pb-1 text-lg font-semibold" {...p} />,
          p: (p) => <p className="my-3 text-sm leading-6 text-slate-700" {...p} />,
          ul: (p) => <ul className="my-3 list-disc space-y-1 pl-6 text-sm text-slate-700" {...p} />,
          ol: (p) => <ol className="my-3 list-decimal space-y-1 pl-6 text-sm text-slate-700" {...p} />,
          li: (p) => <li className="leading-6" {...p} />,
          a: (p) => <a className="text-blue-700 underline" {...p} />,
          table: (p) => (
            <div className="my-4 overflow-x-auto rounded-md border">
              <table className="w-full border-collapse text-sm" {...p} />
            </div>
          ),
          thead: (p) => <thead className="bg-slate-50 text-left" {...p} />,
          th: (p) => <th className="border-b px-3 py-2 font-medium text-slate-600" {...p} />,
          td: (p) => <td className="border-b px-3 py-2 align-top text-slate-700" {...p} />,
          code: (p) => (
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[13px]" {...p} />
          ),
          pre: (p) => (
            <pre
              className="my-4 overflow-x-auto rounded-md border bg-slate-50 p-3 text-xs leading-5"
              {...p}
            />
          ),
        }}
      >
        {doc}
      </Markdown>
    </div>
  );
}
