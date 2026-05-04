import * as Sentry from '@sentry/react';

const DSN = 'https://1fe9af05d59773c71bac38ab98f47bf2@o4511330545500160.ingest.de.sentry.io/4511330551136336';

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  initialized = true;

  Sentry.init({
    dsn: DSN,
    sendDefaultPii: true,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_RELEASE ?? undefined,
    integrations: [Sentry.browserTracingIntegration()],
    // Browser Tracing is on but sampled low so the free tier doesn't get
    // blown by routine page navigations. Errors are 100% by default.
    tracesSampleRate: 0.1,
    tracePropagationTargets: [/^\//, /supabase\.co/],
    // Drop noisy events that aren't actionable.
    ignoreErrors: [
      // Tanstack devtools logs that surface as errors when realtime drops.
      'TypeError: Failed to fetch',
      // Supabase realtime reconnect noise.
      /TimeoutError.*phx_reply/,
      /CHANNEL_ERROR/,
    ],
  });
}

export { Sentry };
