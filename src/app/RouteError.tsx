import { useEffect } from 'react';
import { useRouteError } from 'react-router-dom';
import { isChunkLoadError, reloadForNewVersion } from '@/lib/dynamicImport';

/**
 * React Router errorElement. The common case here is a stale lazy chunk after a
 * deploy ("Failed to fetch dynamically imported module") — we auto-reload once
 * to fetch the new build. Anything else gets a clean "Something went wrong".
 */
export function RouteError() {
  const error = useRouteError();
  const chunk = isChunkLoadError(error);

  useEffect(() => {
    if (chunk) reloadForNewVersion();
  }, [chunk]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-bold">
        {chunk ? 'Updating to the latest version…' : 'Something went wrong'}
      </h1>
      <p className="text-sm text-muted-foreground">
        {chunk
          ? 'A new version of the app is available. Reloading…'
          : 'The team has been notified. Try reloading the page.'}
      </p>
      {!chunk && (
        <pre className="mt-4 max-w-xl overflow-auto rounded bg-muted p-3 text-left text-xs text-muted-foreground">
          {error instanceof Error ? error.message : String(error)}
        </pre>
      )}
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
      >
        Reload
      </button>
    </div>
  );
}
