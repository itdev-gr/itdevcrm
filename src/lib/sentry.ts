import * as Sentry from '@sentry/react';

// Public client DSN (safe to ship in the bundle). Override per-env with
// VITE_SENTRY_DSN if ever needed.
const DSN =
  import.meta.env.VITE_SENTRY_DSN ??
  'https://3521b38c29baf4f2b4e7ec2e220c5a4f@o4511586213232640.ingest.de.sentry.io/4511586222342224';

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  initialized = true;

  // Dev sessions would burn the quota and ship local noise; only report from
  // production builds.
  if (!import.meta.env.PROD) return;

  Sentry.init({
    dsn: DSN,
    // GDPR: don't attach IP / request headers by default. Sentry.setUser in
    // the auth listener still tags events with the user id + email.
    sendDefaultPii: false,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_RELEASE ?? undefined,
    integrations: [
      Sentry.browserTracingIntegration(),
      // Session Replay — records the DOM/interactions so an error comes with a
      // video-like replay of what the user did. Text is masked + media blocked
      // so client PII never leaves the app.
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    // Browser Tracing is on but sampled low so routine navigations don't blow
    // the quota. Errors are captured 100%.
    tracesSampleRate: 0.2,
    tracePropagationTargets: [/^\//, /supabase\.co/],
    // Don't record every session (quota), but capture a full replay whenever an
    // error happens — the detailed "what led to this" context.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    // Capture console + Sentry.logger output as structured logs.
    enableLogs: true,
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
