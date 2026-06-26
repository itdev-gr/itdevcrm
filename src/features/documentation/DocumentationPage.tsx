import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { TechDocView } from '@/components/docs/TechDocView';
import { DOC_AREAS, loadDoc } from './docIndex';

export function DocumentationPage() {
  const [params, setParams] = useSearchParams();
  const firstArea = DOC_AREAS[0]!;
  const firstDoc = firstArea.docs[0]!;
  const current = params.get('doc') ?? `${firstArea.area}/${firstDoc.slug}`;

  let file: string | null = null;
  for (const area of DOC_AREAS) {
    for (const d of area.docs) {
      if (`${area.area}/${d.slug}` === current) file = d.file;
    }
  }
  const markdown = file ? loadDoc(file) : null;

  return (
    <div className="flex min-h-full gap-6">
      <aside className="hidden w-64 shrink-0 lg:block">
        <nav className="sticky top-20 max-h-[calc(100vh-6rem)] space-y-4 overflow-y-auto rounded-xl border border-border/60 bg-card p-4 shadow-sm">
          {DOC_AREAS.map((area) => (
            <div key={area.area}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {area.areaTitle}
              </p>
              <ul className="space-y-0.5">
                {area.docs.map((d) => {
                  const key = `${area.area}/${d.slug}`;
                  const active = current === key;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => setParams({ doc: key })}
                        className={cn(
                          'block w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors',
                          active
                            ? 'bg-primary/10 font-medium text-primary ring-1 ring-primary/25'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        {d.title}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        {markdown ? (
          <TechDocView markdown={markdown} />
        ) : (
          <div className="rounded-xl border border-border/60 bg-card p-8 text-sm text-muted-foreground">
            Documentation for this section is being written.
          </div>
        )}
      </div>
    </div>
  );
}
