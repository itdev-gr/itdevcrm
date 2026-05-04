// Minimal sanity-check endpoint to verify the api/ infrastructure deploys
// independently of the puppeteer-heavy offer-pdf endpoint. Delete after
// the offer-pdf endpoint is confirmed working.
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
}
