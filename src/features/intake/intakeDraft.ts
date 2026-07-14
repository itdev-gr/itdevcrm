// Pure, side-effect-light helpers for the intake wizard's draft handling.
// Everything here is unit-tested (intakeDraft.test.ts) — keep it free of React
// and network code so it stays trivially testable.
import type { IntakeFieldKey, IntakeFormState } from './types';

export const EMPTY_FORM_STATE: IntakeFormState = {
  description: '',
  recommended_site: '',
  contact_email: '',
  contact_phone: '',
  contact_whatsapp: '',
  wants_whatsapp_button: false,
  whatsapp_button_number: '',
  has_existing_domain: true,
  existing_domain: '',
  domain_suggestions: [],
};

/** Which wizard step (1-based) owns each schema field, for error routing. */
export const FIELD_STEP: Record<IntakeFieldKey, number> = {
  description: 1,
  contact_email: 1,
  contact_phone: 1,
  contact_whatsapp: 1,
  recommended_site: 3,
  wants_whatsapp_button: 3,
  whatsapp_button_number: 3,
  has_existing_domain: 3,
  existing_domain: 3,
  domain_suggestions: 3,
};

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Build a full form state from an untrusted server/localStorage `data` object. */
export function hydrateFormState(data: Record<string, unknown>): IntakeFormState {
  return {
    description: asString(data.description),
    recommended_site: asString(data.recommended_site),
    contact_email: asString(data.contact_email),
    contact_phone: asString(data.contact_phone),
    contact_whatsapp: asString(data.contact_whatsapp),
    wants_whatsapp_button: asBool(data.wants_whatsapp_button, false),
    whatsapp_button_number: asString(data.whatsapp_button_number),
    has_existing_domain: asBool(data.has_existing_domain, true),
    existing_domain: asString(data.existing_domain),
    domain_suggestions: asStringArray(data.domain_suggestions),
  };
}

/** Trim + drop blank domain suggestions (schema requires each to be non-empty). */
export function cleanSuggestions(list: string[]): string[] {
  return list.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * The exact object shape we persist server-side (`data`) and validate. It
 * applies the wizard's conditional-clear rules so `missing_items` stays honest:
 * WhatsApp number is dropped when the button is off, and the domain answer only
 * carries the side that `has_existing_domain` selects.
 */
export function normalizeForServer(state: IntakeFormState): Record<string, unknown> {
  return {
    description: state.description,
    recommended_site: state.recommended_site,
    contact_email: state.contact_email,
    contact_phone: state.contact_phone,
    contact_whatsapp: state.contact_whatsapp,
    wants_whatsapp_button: state.wants_whatsapp_button,
    whatsapp_button_number: state.wants_whatsapp_button ? state.whatsapp_button_number : '',
    has_existing_domain: state.has_existing_domain,
    existing_domain: state.has_existing_domain ? state.existing_domain : '',
    domain_suggestions: state.has_existing_domain ? [] : cleanSuggestions(state.domain_suggestions),
  };
}

function isBlank(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * Merge a resumed draft: the server row wins for every field it actually holds a
 * non-empty value for; otherwise the localStorage fallback fills the gap. Booleans
 * that the server has stored (even `false`) count as present and win.
 */
export function mergeDraft(
  serverData: Record<string, unknown>,
  local: IntakeFormState | null,
): IntakeFormState {
  const server = hydrateFormState(serverData);
  if (!local) return server;
  // Server wins where it holds a value; otherwise fall back to the local draft.
  const has = (key: IntakeFieldKey) => !isBlank(serverData[key]);
  return {
    description: has('description') ? server.description : local.description,
    recommended_site: has('recommended_site') ? server.recommended_site : local.recommended_site,
    contact_email: has('contact_email') ? server.contact_email : local.contact_email,
    contact_phone: has('contact_phone') ? server.contact_phone : local.contact_phone,
    contact_whatsapp: has('contact_whatsapp') ? server.contact_whatsapp : local.contact_whatsapp,
    wants_whatsapp_button: has('wants_whatsapp_button')
      ? server.wants_whatsapp_button
      : local.wants_whatsapp_button,
    whatsapp_button_number: has('whatsapp_button_number')
      ? server.whatsapp_button_number
      : local.whatsapp_button_number,
    has_existing_domain: has('has_existing_domain')
      ? server.has_existing_domain
      : local.has_existing_domain,
    existing_domain: has('existing_domain') ? server.existing_domain : local.existing_domain,
    domain_suggestions: has('domain_suggestions')
      ? server.domain_suggestions
      : local.domain_suggestions,
  };
}

/**
 * Diff two form states through the normalized (server-shape) lens and return only
 * the changed keys — the minimal `save {patch}` payload. Uses JSON equality so
 * array/boolean changes are caught.
 */
export function computePatch(
  prev: IntakeFormState,
  next: IntakeFormState,
): Record<string, unknown> {
  const p = normalizeForServer(prev);
  const n = normalizeForServer(next);
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(n)) {
    if (JSON.stringify(p[key]) !== JSON.stringify(n[key])) patch[key] = n[key];
  }
  return patch;
}

/** Human-readable byte size, e.g. 1536 → "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  const rounded = i === 0 ? value : Math.round(value * 10) / 10;
  return `${rounded} ${units[i]}`;
}
