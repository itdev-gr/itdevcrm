import { useEffect, useId, useRef, useState } from 'react';
import { useThemeStore } from '@/lib/stores/themeStore';

/**
 * Renders a Mermaid chart string as an SVG. Mermaid is dynamic-imported so it only
 * loads on pages that actually show a diagram (the Documentation tab). Theme follows
 * the `dark` class applied to <html>; we re-render when the theme mode toggles.
 */
export function MermaidDiagram({ chart }: { chart: string }) {
  const mode = useThemeStore((s) => s.mode); // dependency: re-render diagram on theme toggle
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        const isDark = document.documentElement.classList.contains('dark');
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: isDark ? 'dark' : 'default',
        });
        const { svg } = await mermaid.render(`mmd-${rawId}`, chart);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, mode, rawId]);

  if (error) {
    return (
      <pre className="my-4 overflow-x-auto rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
        {chart}
      </pre>
    );
  }
  return (
    <div
      ref={ref}
      className="my-5 flex justify-center overflow-x-auto rounded-lg border border-border/60 bg-card p-4"
    />
  );
}
