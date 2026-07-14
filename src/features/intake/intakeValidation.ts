// Per-step, client-side validation for the wizard. Reuses the shared single
// source of truth (`phoneRegex`, `intakeFormSchema`) from `@/lib/clientIntake`
// so the browser and the API never drift. Messages are localized via the passed
// `t`. The final submit still runs the full schema parse for belt-and-braces.
import type { TFunction } from 'i18next';
import { z } from 'zod';
import { phoneRegex, intakeFormSchema } from '@/lib/clientIntake';
import { cleanSuggestions, normalizeForServer, FIELD_STEP } from './intakeDraft';
import type { IntakeFieldErrors, IntakeFieldKey, IntakeFormState } from './types';

const emailSchema = z.string().email();
const URL_RE = /^https?:\/\/[^\s]+$/i;

/** Validate a single wizard step; returns localized errors for its fields only. */
export function validateStep(step: number, form: IntakeFormState, t: TFunction): IntakeFieldErrors {
  const e: IntakeFieldErrors = {};

  if (step === 1) {
    if (form.description.trim().length === 0) e.description = t('errors.description_required');
    else if (form.description.trim().length > 5000) e.description = t('errors.description_long');

    if (form.contact_email.trim().length === 0) e.contact_email = t('errors.email_required');
    else if (!emailSchema.safeParse(form.contact_email.trim()).success)
      e.contact_email = t('errors.email_invalid');

    if (form.contact_phone.trim().length === 0) e.contact_phone = t('errors.phone_required');
    else if (!phoneRegex.test(form.contact_phone.trim()))
      e.contact_phone = t('errors.phone_invalid');

    if (form.contact_whatsapp.trim().length > 0 && !phoneRegex.test(form.contact_whatsapp.trim()))
      e.contact_whatsapp = t('errors.whatsapp_invalid');
  }

  if (step === 3) {
    if (form.recommended_site.trim().length > 0 && !URL_RE.test(form.recommended_site.trim()))
      e.recommended_site = t('errors.url_invalid');

    if (form.wants_whatsapp_button) {
      if (form.whatsapp_button_number.trim().length === 0)
        e.whatsapp_button_number = t('errors.whatsapp_button_required');
      else if (!phoneRegex.test(form.whatsapp_button_number.trim()))
        e.whatsapp_button_number = t('errors.whatsapp_invalid');
    }

    if (form.has_existing_domain) {
      if (form.existing_domain.trim().length === 0)
        e.existing_domain = t('errors.existing_domain_required');
    } else if (cleanSuggestions(form.domain_suggestions).length < 1) {
      e.domain_suggestions = t('errors.domain_suggestions_required');
    }
  }

  return e;
}

/**
 * Full-form validation used at submit time. Runs the shared zod schema and maps
 * any failing field to its step's localized message; returns `{}` when valid.
 */
export function validateAll(form: IntakeFormState, t: TFunction): IntakeFieldErrors {
  const step1 = validateStep(1, form, t);
  const step3 = validateStep(3, form, t);
  const combined = { ...step1, ...step3 };
  if (Object.keys(combined).length > 0) return combined;
  // Backstop: if the field-level checks all pass, trust the schema for anything
  // subtle we may have missed, mapping the first failing field generically.
  const parsed = intakeFormSchema.safeParse(normalizeForServer(form));
  if (parsed.success) return {};
  const out: IntakeFieldErrors = {};
  for (const key of Object.keys(z.flattenError(parsed.error).fieldErrors) as IntakeFieldKey[]) {
    out[key] = t('errors.invalid');
  }
  return out;
}

/** Earliest wizard step (1-based) that has a validation error, else null. */
export function firstErrorStep(errors: IntakeFieldErrors): number | null {
  let min: number | null = null;
  for (const key of Object.keys(errors) as IntakeFieldKey[]) {
    const step = FIELD_STEP[key];
    if (min === null || step < min) min = step;
  }
  return min;
}
