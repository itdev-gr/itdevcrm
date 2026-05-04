// Temporary verification page for the Sentry integration. Visit
// /sentry-check, click the button, then confirm the error appears in the
// Sentry dashboard within ~30 seconds. Delete this file (and its route)
// once verified.

export function SentryCheckPage() {
  return (
    <div className="flex min-h-full flex-col items-start gap-4 p-8">
      <h1 className="text-2xl font-bold">Sentry check</h1>
      <p className="max-w-prose text-sm text-slate-600">
        Click the button to throw a test error. It should land in the Sentry
        dashboard tagged with the currently logged-in user. After you confirm
        it works, ask me to remove this page.
      </p>
      <button
        type="button"
        onClick={() => {
          throw new Error('This is your first error!');
        }}
        className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
      >
        Break the world
      </button>
    </div>
  );
}
