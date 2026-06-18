import * as Sentry from '@sentry/node';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Public client DSN (same Sentry project as the frontend). Override with the
// SENTRY_DSN env var if ever needed.
const DSN =
  process.env.SENTRY_DSN ??
  'https://3521b38c29baf4f2b4e7ec2e220c5a4f@o4511586213232640.ingest.de.sentry.io/4511586222342224';

let inited = false;
function ensureInit(): void {
  if (inited) return;
  inited = true;
  Sentry.init({
    dsn: DSN,
    environment: process.env.VERCEL_ENV ?? 'production',
    sendDefaultPii: false,
    // Error capture only (no perf tracing) — keeps serverless latency minimal.
    tracesSampleRate: 0,
  });
}

type Handler = (req: VercelRequest, res: VercelResponse) => void | Promise<void>;

/**
 * Wrap a Vercel API handler so any UNHANDLED error is reported to Sentry (and a
 * 500 is returned). Handlers that catch their own errors should additionally
 * call `Sentry.captureException` in their catch. The finally-flush is required
 * on serverless (the instance can freeze before the event is sent); it returns
 * instantly when nothing is queued.
 */
export function withSentry(route: string, handler: Handler): Handler {
  return async (req, res) => {
    ensureInit();
    try {
      await handler(req, res);
    } catch (err) {
      Sentry.captureException(err, { tags: { route, method: req.method ?? '' } });
      if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
    } finally {
      await Sentry.flush(2000);
    }
  };
}

/** For handlers that catch their own errors — report + ensure init. */
export function captureApiError(route: string, err: unknown): void {
  ensureInit();
  Sentry.captureException(err, { tags: { route } });
}

export { Sentry };
