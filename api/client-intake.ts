import { withSentry } from './_sentry.js';
// api/client-intake.ts
// Public, token-gated intake API for the Web Dev client intake form. This is the
// ONLY ingress for the anonymous wizard SPA (Task 4) — the browser never touches
// the `job_intake_forms`/`job_intake_files` tables or the private `client-intake`
// bucket directly. Every action re-validates the token against the form row via
// the service-role client (which bypasses RLS), so a stolen link only ever
// exposes the one job it was issued for.
//
//   GET  /api/client-intake?token=<uuid>&action=load
//   POST /api/client-intake   { token, action, ... }
//
// Same-origin only (the SPA serves the form), so no CORS headers are emitted and
// any method other than GET/POST is rejected 405. All validation/limits are
// single-sourced from `src/lib/clientIntake` — never duplicated here.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { rateLimit } from './_rate-limit.js';
import {
  intakeFormSchema,
  intakeLinkState,
  missingItems,
  sanitizeIntakeFileName,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_LOGO_BYTES,
} from '../src/lib/clientIntake.js';
import { z } from 'zod';

// Loose 36-char UUID shape guard, applied before any DB hit (per the brief).
const TOKEN_RE = /^[0-9a-f-]{36}$/i;
// Persisted language choice: keep it to a plain 2-letter code so junk never
// lands in the `locale` column.
const LOCALE_RE = /^[a-z]{2}$/i;
const BUCKET = 'client-intake';
// 60/min: a legit session burns ~2 calls per uploaded file plus debounced
// autosaves, so 30 was tight for a photo-heavy intake; still throttles abuse.
const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

// Draft-patch whitelist — exactly the `intakeFormSchema` object field names.
// `save` shallow-merges only these into `data`; anything else is dropped so a
// malicious client can't stuff arbitrary keys into the row. Keep in sync with
// the schema in src/lib/clientIntake.ts.
export const INTAKE_PATCH_KEYS = [
  'description',
  'recommended_site',
  'contact_email',
  'contact_phone',
  'contact_whatsapp',
  'wants_whatsapp_button',
  'whatsapp_button_number',
  'has_existing_domain',
  'existing_domain',
  'domain_suggestions',
] as const;

const PATCH_KEY_SET = new Set<string>(INTAKE_PATCH_KEYS);

/** Keep only whitelisted draft fields from an untrusted patch object. */
export function filterPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (PATCH_KEY_SET.has(k)) out[k] = v;
  }
  return out;
}

/** Storage key for a job's logo (single per form; overwrites the previous one). */
export function logoStoragePath(jobId: string, safeName: string): string {
  return `job/${jobId}/logo-${safeName}`;
}

/** Storage key for one uploaded file; `uniqueId` keeps same-named files distinct. */
export function fileStoragePath(jobId: string, uniqueId: string, safeName: string): string {
  return `job/${jobId}/${uniqueId}-${safeName}`;
}

/** First value of `x-forwarded-for` (the real client on Vercel), else a fallback. */
export function firstForwardedFor(xff: string | string[] | undefined): string {
  const raw = Array.isArray(xff) ? xff[0] : xff;
  const first = (raw ?? '').split(',')[0]?.trim();
  return first && first.length > 0 ? first : 'unknown';
}

// Human-readable logo filename derived from its storage key (`logo-<safeName>`);
// used only for display since there is no dedicated column for it.
function logoFileName(storagePath: string): string {
  const base = storagePath.split('/').pop() ?? storagePath;
  return base.replace(/^logo-/, '');
}

// Factory so `Admin` is exactly the (untyped) client shape a no-generic
// createClient() call produces — a bare ReturnType<typeof createClient> resolves
// to the generic *defaults* instead and won't accept the real value.
function makeAdmin(url: string, key: string) {
  return createClient(url, key);
}
type Admin = ReturnType<typeof makeAdmin>;

function asObject(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// Throw on an unexpected Postgres/Storage error so the withSentry wrapper reports
// it and returns 500 — expected/validation failures return a JSON {error} instead.
function assertOk(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`client-intake ${context}: ${error.message}`);
}

async function signedLogo(
  admin: Admin,
  logoPath: string | null,
): Promise<{ path: string; url: string | null; file_name: string } | null> {
  if (!logoPath) return null;
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(logoPath, 3600);
  return { path: logoPath, url: data?.signedUrl ?? null, file_name: logoFileName(logoPath) };
}

// The {files, logo, missing_items} block shared by load / file-added / file-removed.
async function fileState(
  admin: Admin,
  jobId: string,
  logoPath: string | null,
  data: Record<string, unknown>,
): Promise<{
  files: unknown[];
  logo: { path: string; url: string | null; file_name: string } | null;
  missing_items: string[];
}> {
  const { data: files, error } = await admin
    .from('job_intake_files')
    .select('id, file_name, file_size, mime_type')
    .eq('job_id', jobId)
    .order('uploaded_at', { ascending: true });
  assertOk(error, 'list files');
  const list = files ?? [];
  const logo = await signedLogo(admin, logoPath);
  const missing_items = missingItems({ logo_path: logoPath, fileCount: list.length, data });
  return { files: list, logo, missing_items };
}

// Re-read the form row (token is unique) so callers that just mutated logo_path/
// data see the current values.
async function reloadForm(
  admin: Admin,
  token: string,
): Promise<{ job_id: string; logo_path: string | null; data: Record<string, unknown> }> {
  const { data: form, error } = await admin
    .from('job_intake_forms')
    .select('job_id, logo_path, data')
    .eq('token', token)
    .single();
  assertOk(error, 'reload form');
  if (!form) throw new Error('client-intake reload form: row vanished');
  return {
    job_id: form.job_id as string,
    logo_path: (form.logo_path as string | null) ?? null,
    data: asObject(form.data),
  };
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Per-IP abuse throttle (best-effort, per serverless instance).
  const ip = firstForwardedFor(req.headers['x-forwarded-for']);
  const rl = rateLimit(ip, RATE_LIMIT);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
    res.status(429).json({ error: 'rate_limited' });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const body = asObject(req.body);
  const query = req.query as Record<string, unknown>;
  const token = String(query.token ?? body.token ?? '');
  const action = String(query.action ?? body.action ?? '');

  if (!TOKEN_RE.test(token)) {
    res.status(400).json({ error: 'invalid_token' });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: 'server_misconfigured' });
    return;
  }
  const admin = makeAdmin(supabaseUrl, serviceRoleKey);

  // Token → form. `intakeLinkState` keeps the locked/expired precedence
  // single-sourced with the SPA; `submitted` stays valid (reopenable). The
  // null (not_found) branch is handled first so `form` narrows non-null below.
  const { data: form, error: formErr } = await admin
    .from('job_intake_forms')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  assertOk(formErr, 'load form');
  if (!form) {
    res.status(403).json({ error: 'not_found' });
    return;
  }
  const state = intakeLinkState({ status: form.status as string, expires_at: form.expires_at as string });
  if (state === 'locked') {
    res.status(403).json({ error: 'locked' });
    return;
  }
  if (state === 'expired') {
    res.status(403).json({ error: 'expired' });
    return;
  }

  const jobId = form.job_id as string;
  const formData = asObject(form.data);
  const logoPath = (form.logo_path as string | null) ?? null;

  // Only `load` may be reached via GET; every mutating action requires POST.
  if (req.method === 'GET' && action !== 'load') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  switch (action) {
    case 'load': {
      const { data: job, error: jobErr } = await admin
        .from('jobs')
        .select('code, client_id, clients(name)')
        .eq('id', jobId)
        .maybeSingle();
      assertOk(jobErr, 'load job');
      const clientRel = job?.clients as { name?: string } | { name?: string }[] | null | undefined;
      const client_name = Array.isArray(clientRel)
        ? (clientRel[0]?.name ?? null)
        : (clientRel?.name ?? null);
      const { files, logo, missing_items } = await fileState(admin, jobId, logoPath, formData);
      res.status(200).json({
        status: form.status,
        locale: form.locale,
        data: formData,
        client_name,
        job_code: (job?.code as string | null) ?? null,
        logo,
        files,
        missing_items,
      });
      return;
    }

    case 'save': {
      const rawPatch = body.patch;
      if (rawPatch !== undefined && (typeof rawPatch !== 'object' || rawPatch === null || Array.isArray(rawPatch))) {
        res.status(400).json({ error: 'invalid_patch' });
        return;
      }
      const filtered = rawPatch ? filterPatch(rawPatch as Record<string, unknown>) : {};
      const update: Record<string, unknown> = { data: { ...formData, ...filtered } };
      if (typeof body.locale === 'string' && LOCALE_RE.test(body.locale)) update.locale = body.locale;
      const { error } = await admin.from('job_intake_forms').update(update).eq('token', token);
      assertOk(error, 'save draft');
      res.status(200).json({ ok: true });
      return;
    }

    case 'upload-url': {
      const kind = body.kind;
      if (kind !== 'logo' && kind !== 'file') {
        res.status(400).json({ error: 'invalid_kind' });
        return;
      }
      const fileName = String(body.file_name ?? '');
      const mimeType = String(body.mime_type ?? '');
      const size = Number(body.size);
      if (!Number.isFinite(size) || size <= 0) {
        res.status(400).json({ error: 'empty_file' });
        return;
      }
      if (kind === 'logo') {
        if (!mimeType.startsWith('image/')) {
          res.status(400).json({ error: 'not_image' });
          return;
        }
        if (size > MAX_LOGO_BYTES) {
          res.status(413).json({ error: 'logo_too_large' });
          return;
        }
      } else {
        if (size > MAX_FILE_BYTES) {
          res.status(413).json({ error: 'file_too_large' });
          return;
        }
        // Per-intake quota: sum of already-stored files + this one.
        const { data: rows, error: sumErr } = await admin
          .from('job_intake_files')
          .select('file_size')
          .eq('job_id', jobId);
        assertOk(sumErr, 'quota sum');
        const used = (rows ?? []).reduce((acc: number, r) => acc + Number(r.file_size ?? 0), 0);
        if (used + size > MAX_TOTAL_BYTES) {
          res.status(413).json({ error: 'quota_exceeded' });
          return;
        }
      }
      const safeName = sanitizeIntakeFileName(fileName);
      const storagePath =
        kind === 'logo' ? logoStoragePath(jobId, safeName) : fileStoragePath(jobId, randomUUID(), safeName);
      // Logo reuses a stable path (`logo-<safeName>`), so a re-upload of a
      // same-named file must overwrite instead of failing with "already exists".
      const { data: signed, error: signErr } = await admin.storage
        .from(BUCKET)
        .createSignedUploadUrl(storagePath, { upsert: kind === 'logo' });
      assertOk(signErr, 'signed upload url');
      // The logo row / job_intake_files row is only written on `file-added`, once
      // the browser confirms the upload actually succeeded.
      res.status(200).json({
        signed_url: signed?.signedUrl,
        upload_token: signed?.token,
        storage_path: signed?.path,
      });
      return;
    }

    case 'file-added': {
      const kind = body.kind;
      if (kind !== 'logo' && kind !== 'file') {
        res.status(400).json({ error: 'invalid_kind' });
        return;
      }
      const storagePath = String(body.storage_path ?? '');
      // Scope strictly to this form's job — never trust a client-supplied path.
      if (!storagePath.startsWith(`job/${jobId}/`)) {
        res.status(400).json({ error: 'invalid_path' });
        return;
      }
      if (kind === 'logo') {
        if (logoPath && logoPath !== storagePath) {
          await admin.storage.from(BUCKET).remove([logoPath]);
        }
        const { error } = await admin
          .from('job_intake_forms')
          .update({ logo_path: storagePath })
          .eq('token', token);
        assertOk(error, 'set logo_path');
      } else {
        const size = Number(body.size);
        const { error } = await admin.from('job_intake_files').upsert(
          {
            job_id: jobId,
            file_name: String(body.file_name ?? ''),
            file_size: Number.isFinite(size) ? size : 0,
            mime_type: body.mime_type == null ? null : String(body.mime_type),
            storage_path: storagePath,
          },
          { onConflict: 'storage_path', ignoreDuplicates: true },
        );
        assertOk(error, 'insert file row');
      }
      const next = await reloadForm(admin, token);
      const result = await fileState(admin, jobId, next.logo_path, next.data);
      res.status(200).json(result);
      return;
    }

    case 'file-removed': {
      if (body.kind === 'logo') {
        if (logoPath) await admin.storage.from(BUCKET).remove([logoPath]);
        const { error } = await admin
          .from('job_intake_forms')
          .update({ logo_path: null })
          .eq('token', token);
        assertOk(error, 'clear logo_path');
      } else {
        const id = String(body.id ?? '');
        if (!TOKEN_RE.test(id)) {
          res.status(400).json({ error: 'invalid_input' });
          return;
        }
        // Scope the lookup to this job so one form can't delete another's files.
        const { data: fileRow, error: findErr } = await admin
          .from('job_intake_files')
          .select('storage_path')
          .eq('id', id)
          .eq('job_id', jobId)
          .maybeSingle();
        assertOk(findErr, 'find file row');
        if (!fileRow) {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        await admin.storage.from(BUCKET).remove([fileRow.storage_path as string]);
        const { error: delErr } = await admin
          .from('job_intake_files')
          .delete()
          .eq('id', id)
          .eq('job_id', jobId);
        assertOk(delErr, 'delete file row');
      }
      const next = await reloadForm(admin, token);
      const result = await fileState(admin, jobId, next.logo_path, next.data);
      res.status(200).json(result);
      return;
    }

    case 'submit': {
      const parsed = intakeFormSchema.safeParse(body.data);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_input', fields: z.flattenError(parsed.error).fieldErrors });
        return;
      }
      const now = new Date().toISOString();
      const update: Record<string, unknown> = {
        data: parsed.data,
        submitted_at: now,
        // coalesce(existing, now): keep the very first submission timestamp.
        first_submitted_at: (form.first_submitted_at as string | null) ?? now,
        status: 'submitted',
      };
      if (typeof body.locale === 'string' && LOCALE_RE.test(body.locale)) update.locale = body.locale;
      // Setting submitted_at fires the DB AFTER-UPDATE trigger (internal email +
      // activity log) — we must NOT enqueue any email here.
      const { error } = await admin.from('job_intake_forms').update(update).eq('token', token);
      assertOk(error, 'submit form');

      const { count, error: countErr } = await admin
        .from('job_intake_files')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', jobId);
      assertOk(countErr, 'count files');
      const missing_items = missingItems({
        logo_path: logoPath,
        fileCount: count ?? 0,
        data: parsed.data as Record<string, unknown>,
      });
      res.status(200).json({ ok: true, missing_items });
      return;
    }

    default: {
      res.status(400).json({ error: 'invalid_action' });
      return;
    }
  }
}

export default withSentry('client-intake', handler);
