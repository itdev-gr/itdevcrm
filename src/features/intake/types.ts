// Shared types for the public client-intake wizard (Task 4).
// Kept dependency-free (no supabase / auth imports) so the whole /f/:token
// module graph stays free of privileged code.
import type { TFunction } from 'i18next';

export type IntakeLang = 'el' | 'en';

/**
 * Controlled form state for the wizard. Every field is held as a plain input
 * value (strings / booleans / arrays) — the shared zod schema does the trimming
 * and `'' → null` transforms at save/submit time, so this shape stays simple.
 */
export interface IntakeFormState {
  description: string;
  recommended_site: string;
  contact_email: string;
  contact_phone: string;
  contact_whatsapp: string;
  wants_whatsapp_button: boolean;
  whatsapp_button_number: string;
  has_existing_domain: boolean;
  existing_domain: string;
  domain_suggestions: string[];
}

export type IntakeFieldKey = keyof IntakeFormState;

export type IntakeFieldErrors = Partial<Record<IntakeFieldKey, string>>;

/** A persisted uploaded file, as returned by the API. */
export interface IntakeFileRow {
  id: string;
  file_name: string;
  file_size: number;
  mime_type: string | null;
}

/** The logo block returned by the API (signed URL is short-lived). */
export interface IntakeLogo {
  path: string;
  url: string | null;
  file_name: string;
}

/** The `{files, logo, missing_items}` block shared by several API actions. */
export interface IntakeFileState {
  files: IntakeFileRow[];
  logo: IntakeLogo | null;
  missing_items: string[];
}

/** GET ?action=load response. */
export interface IntakeLoadResponse extends IntakeFileState {
  status: string;
  locale: string | null;
  data: Record<string, unknown>;
  client_name: string | null;
  job_code: string | null;
}

/** Props shared by the plain (non-upload) wizard steps. */
export interface StepProps {
  form: IntakeFormState;
  updateForm: (partial: Partial<IntakeFormState>) => void;
  errors: IntakeFieldErrors;
  t: TFunction;
}
