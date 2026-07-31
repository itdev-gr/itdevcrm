import { useMutation, useQuery, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

/**
 * Staff-side data hooks for the Web Dev client-intake form. The
 * `job_intake_forms` / `job_intake_files` tables (added in migration
 * 20260714150000) are not in the generated Supabase types, so every call casts
 * the table name / payload with `as never` — the same pattern used by
 * `useBccEmails` / `useJobsBilling` for as-yet-untyped tables.
 *
 * All writes go through the AUTHENTICATED client and are governed by the RLS in
 * that migration: staff SELECT is open; INSERT requires `created_by = auth.uid()`;
 * UPDATE requires admin / web_dev edit / accounting_onboarding edit.
 */

export type IntakeStatus = 'draft' | 'submitted' | 'locked';

export type JobIntakeForm = {
  job_id: string;
  token: string;
  status: IntakeStatus;
  data: Record<string, unknown>;
  logo_path: string | null;
  locale: string;
  expires_at: string;
  sent_at: string | null;
  first_submitted_at: string | null;
  submitted_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type JobIntakeFile = {
  id: string;
  job_id: string;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  storage_path: string;
  uploaded_at: string;
};

export function jobIntakeKey(jobId: string) {
  return ['job-intake', jobId] as const;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO timestamp 30 days from now — the intake link's default lifetime (matches
 *  the table's `expires_at` server default). */
export function intakeExpiryIso(): string {
  return new Date(Date.now() + 30 * DAY_MS).toISOString();
}

/** The form row (if any) plus its uploaded files, for one web_dev job. */
export function useJobIntake(jobId: string) {
  return useQuery({
    queryKey: jobIntakeKey(jobId),
    enabled: !!jobId,
    queryFn: async (): Promise<{ form: JobIntakeForm | null; files: JobIntakeFile[] }> => {
      const formRes = await supabase
        .from('job_intake_forms' as never)
        .select('*')
        .eq('job_id', jobId)
        .maybeSingle();
      if (formRes.error) throw new Error(formRes.error.message);
      const form = (formRes.data as unknown as JobIntakeForm | null) ?? null;
      if (!form) return { form: null, files: [] };

      const filesRes = await supabase
        .from('job_intake_files' as never)
        .select('*')
        .eq('job_id', jobId)
        .order('uploaded_at', { ascending: true });
      if (filesRes.error) throw new Error(filesRes.error.message);
      return { form, files: (filesRes.data as unknown as JobIntakeFile[]) ?? [] };
    },
  });
}

/** Create the form row for a job. token / expires_at default server-side. */
export function useCreateIntakeForm() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, { jobId: string; createdBy: string }>({
    mutationFn: captureMutation('webdev_intake', 'create_form', async ({ jobId, createdBy }) => {
      const { error } = await supabase
        .from('job_intake_forms' as never)
        .insert({ job_id: jobId, created_by: createdBy } as never);
      if (error) throw new Error(error.message);
    }),
    onSuccess: (_v, { jobId }) => void qc.invalidateQueries({ queryKey: jobIntakeKey(jobId) }),
  });
}

/** Patch the form row (regenerate / lock / reopen). */
export function useUpdateIntakeForm() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, { jobId: string; patch: Record<string, unknown> }>({
    mutationFn: captureMutation('webdev_intake', 'update_form', async ({ jobId, patch }) => {
      const { error } = await supabase
        .from('job_intake_forms' as never)
        .update(patch as never)
        .eq('job_id', jobId);
      if (error) throw new Error(error.message);
    }),
    onSuccess: (_v, { jobId }) => void qc.invalidateQueries({ queryKey: jobIntakeKey(jobId) }),
  });
}

type SendInput = {
  jobId: string;
  to: string;
  code: string;
  clientName: string;
  link: string;
  /** Defaults to the initial `webdev_client_form`. Pass `webdev_form_followup`
   *  for the follow-up reminder — same data shape, but sent_at is NOT re-stamped
   *  (that date tracks the initial form send, not the reminder). */
  templateKey?: string;
};

/**
 * Send the client-facing `webdev_client_form` link email. Mirrors
 * `useRequestSeoAccess` exactly — same `send-email` invoke shape, same
 * `identity: 'accounting'`, same error-context unwrapping and status check — but
 * with this template + `{ code, client_name, link }` data. On the INITIAL send it
 * stamps `sent_at = now()` on the form row so the badge flips to "Sent"
 * (follow-ups skip that). Re-sends allowed.
 */
export function useSendIntakeForm() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, SendInput>({
    mutationFn: captureMutation('webdev_intake', 'send_form', async (input: SendInput) => {
      const templateKey = input.templateKey ?? 'webdev_client_form';
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          identity: 'accounting',
          to: input.to,
          templateKey,
          data: { code: input.code, client_name: input.clientName, link: input.link },
        },
      });
      if (error) {
        let msg = error.message;
        try {
          const ctx = error.context as { json?: () => Promise<{ error?: string }> } | undefined;
          if (ctx?.json) {
            const j = await ctx.json();
            if (j?.error) msg = j.error;
          }
        } catch {
          // ignore — fall back to error.message
        }
        throw new Error(msg);
      }
      const status = (data as { status?: string; error?: string } | null)?.status;
      if (status !== 'sent' && status !== 'skipped') {
        throw new Error((data as { error?: string } | null)?.error ?? 'send failed');
      }
      // Only the initial form email stamps sent_at (drives the "Sent" badge);
      // a follow-up reminder leaves the original send date intact.
      if (templateKey === 'webdev_client_form') {
        const upd = await supabase
          .from('job_intake_forms' as never)
          .update({ sent_at: new Date().toISOString() } as never)
          .eq('job_id', input.jobId);
        if (upd.error) throw new Error(upd.error.message);
      }
    }),
    onSuccess: (_v, input) => void qc.invalidateQueries({ queryKey: jobIntakeKey(input.jobId) }),
  });
}
