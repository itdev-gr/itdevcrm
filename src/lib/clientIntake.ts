/**
 * Shared client-intake validation module.
 *
 * SINGLE SOURCE OF TRUTH for the Web Dev client-intake form. Both the public
 * Vite wizard SPA and the Vercel service-role `api/` functions import this file,
 * so it MUST stay dependency-free apart from `zod` (already a dependency) and a
 * relative import of the dependency-free `sanitizeStorageKey` helper. Never add
 * `@/…` alias imports here — the Vercel api bundler does not resolve them.
 *
 * Ported from info-website-main (`src/lib/validation.ts`, `src/lib/file-limits.ts`,
 * `src/lib/tokens.ts`). Validation semantics/messages are kept verbatim; the
 * link-state precedence is re-specified per the CRM feature (submitted stays
 * valid, reopenable until locked).
 */
import { z } from 'zod';
// Re-exported (not duplicated) because sanitizeStorageKey.ts has zero imports
// and so is safe for the Vercel api bundler. See its own header for the rule.
import { sanitizeStorageFileName } from './sanitizeStorageKey';

const trimmedString = (min = 0, max?: number) => {
  let s = z.string().trim().min(min);
  if (max !== undefined) s = s.max(max);
  return s;
};

const domainSuggestion = z.string().trim().min(1).max(253);

// Very loose phone validation — international numbers vary too much to lock down.
// Accepts digits, spaces, dashes, parentheses, dots, and a leading +.
export const phoneRegex = /^[+\d][\d\s().-]{5,30}$/;

export const intakeFormSchema = z
  .object({
    description: trimmedString(1, 5_000),
    recommended_site: z
      .string()
      .trim()
      .max(500)
      .refine((v) => v === '' || /^https?:\/\/[^\s]+$/i.test(v), { message: 'Must be a valid http(s) URL' })
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .default(null),
    contact_email: z.string().trim().min(1, 'Email is required').email('Invalid email').max(320),
    contact_phone: z
      .string()
      .trim()
      .min(1, 'Phone is required')
      .max(40)
      .refine((v) => phoneRegex.test(v), { message: 'Invalid phone number' }),
    contact_whatsapp: z
      .string()
      .trim()
      .max(40)
      .refine((v) => v === '' || phoneRegex.test(v), { message: 'Invalid WhatsApp number' })
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .default(null),
    wants_whatsapp_button: z.boolean(),
    whatsapp_button_number: z
      .string()
      .trim()
      .max(40)
      .refine((v) => v === '' || phoneRegex.test(v), { message: 'Invalid WhatsApp number' })
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .default(null),
    has_existing_domain: z.boolean(),
    existing_domain: z
      .string()
      .trim()
      .max(253)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    domain_suggestions: z.array(domainSuggestion).max(3),
  })
  .superRefine((data, ctx) => {
    if (data.wants_whatsapp_button && !data.whatsapp_button_number) {
      ctx.addIssue({ code: 'custom', path: ['whatsapp_button_number'], message: 'WhatsApp number is required when the button is enabled' });
    }
    if (data.has_existing_domain) {
      if (!data.existing_domain || data.existing_domain.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['existing_domain'], message: 'Required when has_existing_domain is true' });
      }
    } else {
      if (data.domain_suggestions.length < 1) {
        ctx.addIssue({ code: 'custom', path: ['domain_suggestions'], message: 'At least one suggestion required' });
      }
    }
  });

export type IntakeFormData = z.infer<typeof intakeFormSchema>;

// ── Upload limits ──────────────────────────────────────────────────────────
export const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500 MB — any single upload
export const MAX_TOTAL_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB — per-intake quota
export const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5 MB — logo image only

/**
 * Reduce a filename to a Supabase Storage–safe key segment. Re-exported from the
 * repo's dependency-free `sanitizeStorageKey` helper: `[^a-zA-Z0-9._-]` → `_`,
 * then sliced to 200 chars. Callers prefix a timestamp/uuid for uniqueness.
 */
export const sanitizeIntakeFileName = sanitizeStorageFileName;

// ── Link-state precedence ────────────────────────────────────────────────────
/**
 * Pure (no-DB) validation precedence for an intake link, derived from the
 * `job_intake_forms` row's `status` + `expires_at`.
 *
 * Precedence (first match wins):
 *   1. null form          → 'not_found'
 *   2. status = 'locked'  → 'locked'   (beats expiry)
 *   3. expires_at <= now  → 'expired'
 *   4. otherwise          → 'valid'
 *
 * Unlike the original tokens.ts, a `submitted` form stays VALID — the link is
 * reopenable by the client until an operator locks it.
 */
export function intakeLinkState(
  form: { status: string; expires_at: string } | null,
  now: Date = new Date(),
): 'not_found' | 'locked' | 'expired' | 'valid' {
  if (!form) return 'not_found';
  if (form.status === 'locked') return 'locked';
  if (new Date(form.expires_at).getTime() <= now.getTime()) return 'expired';
  return 'valid';
}

// ── Missing-items calculator ─────────────────────────────────────────────────
function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  return false;
}

/**
 * Compute which required intake items are still missing, as translation KEYS
 * (callers render the display text). Order is stable for readable summaries.
 *
 * - 'logo'          when no logo_path
 * - 'files'         when fileCount === 0
 * - 'description'   when the description answer is absent/empty
 * - 'contact_email' when the contact email answer is absent/empty
 * - 'contact_phone' when the contact phone answer is absent/empty
 * - 'domain'        when has_existing_domain is true but existing_domain is
 *                   absent/empty, OR false with no domain_suggestions
 */
export function missingItems(input: {
  logo_path: string | null;
  fileCount: number;
  data: Record<string, unknown>;
}): string[] {
  const { logo_path, fileCount, data } = input;
  const missing: string[] = [];

  if (!logo_path) missing.push('logo');
  if (fileCount === 0) missing.push('files');
  if (isEmptyValue(data.description)) missing.push('description');
  if (isEmptyValue(data.contact_email)) missing.push('contact_email');
  if (isEmptyValue(data.contact_phone)) missing.push('contact_phone');

  if (data.has_existing_domain === true) {
    if (isEmptyValue(data.existing_domain)) missing.push('domain');
  } else {
    const suggestions = data.domain_suggestions;
    if (!Array.isArray(suggestions) || suggestions.length < 1) missing.push('domain');
  }

  return missing;
}
