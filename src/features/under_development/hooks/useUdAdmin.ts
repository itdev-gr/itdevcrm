import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/supabase';
import type { CadenceRow, CadenceStepRow } from './useLeadCadence';

export type UdSettingsRow = Database['public']['Tables']['ud_cadence_settings']['Row'] & {
  // Added after the last types regen.
  auto_pause_enabled?: boolean;
};

export type CadenceWithSteps = CadenceRow & { steps: CadenceStepRow[] };
export type UdTemplateLite = { key: string; subject: string };

function invalidate(qc: QueryClient) {
  for (const key of [['ud-admin'], ['sales-cadence'], ['lead-cadence']] as const) {
    void qc.invalidateQueries({ queryKey: [...key] });
  }
}

/** All chain definitions + their steps, for the admin page. */
export function useUdCadencesAdmin() {
  return useQuery<CadenceWithSteps[]>({
    queryKey: ['ud-admin', 'cadences'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ud_cadences')
        .select('*, steps:ud_cadence_steps(*)')
        .order('key');
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as CadenceWithSteps[];
      for (const c of rows) c.steps.sort((a, b) => a.position - b.position);
      return rows;
    },
  });
}

/** Subjects of the ud_* email templates so email steps show real labels. */
export function useUdTemplates() {
  return useQuery<Map<string, string>>({
    queryKey: ['ud-admin', 'templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_templates')
        .select('key, subject')
        .like('key', 'ud_%');
      if (error) throw new Error(error.message);
      return new Map(((data ?? []) as UdTemplateLite[]).map((t) => [t.key, t.subject]));
    },
  });
}

export function useUpdateUdCadence() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; enabled: boolean }>({
    mutationFn: async ({ id, enabled }) => {
      const { error } = await supabase.from('ud_cadences').update({ enabled }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateUdStep() {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { id: string; patch: { delay_days?: number; delay_hours?: number; enabled?: boolean; titles?: unknown } }
  >({
    mutationFn: async ({ id, patch }) => {
      const { error } = await supabase
        .from('ud_cadence_steps')
        .update(patch as never)
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useUdSettings() {
  return useQuery<UdSettingsRow | null>({
    queryKey: ['ud-admin', 'settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ud_cadence_settings')
        .select('*')
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as UdSettingsRow | null;
    },
  });
}

export function useUpdateUdSettings() {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { overdue_rep_days?: number; overdue_admin_days?: number; auto_pause_enabled?: boolean }
  >({
    mutationFn: async (patch) => {
      const { error } = await supabase
        .from('ud_cadence_settings')
        .update(patch as never)
        .eq('id', true);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidate(qc),
  });
}
