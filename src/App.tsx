import { RouterProvider } from 'react-router-dom';
import { Sentry } from './lib/sentry';
import { router } from './app/router';

function ErrorFallback({ error }: { error: unknown }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        The team has been notified. Try reloading the page.
      </p>
      <pre className="mt-4 max-w-xl overflow-auto rounded bg-muted p-3 text-left text-xs text-muted-foreground">
        {error instanceof Error ? error.message : String(error)}
      </pre>
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

export default function App() {
  return (
    <Sentry.ErrorBoundary fallback={ErrorFallback}>
      <RouterProvider router={router} />
    </Sentry.ErrorBoundary>
  );
}
