import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

export type EmailTemplateRow = {
  key: string;
  description: string;
  subject: string;
  body: string;
  variables: string;
  client_facing: boolean;
};

export type AutomationSettingRow = { key: string; description: string; enabled: boolean };

export type SequenceStepRow = {
  id: string;
  sequence_id: string;
  position: number;
  day_offset: number;
  template_key: string;
  enabled: boolean;
};

export type SequenceRow = {
  id: string;
  key: string;
  display_name: string;
  description: string;
  enabled: boolean;
  steps: SequenceStepRow[];
};

export function useEmailTemplates() {
  return useQuery({
    queryKey: ['email-templates'] as const,
    queryFn: async (): Promise<EmailTemplateRow[]> => {
      const { data, error } = await supabase.from('email_templates').select('*').order('key');
      if (error) throw new Error(error.message);
      return (data ?? []) as EmailTemplateRow[];
    },
  });
}

export function useUpdateEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation(
      'email_templates',
      'update',
      async (input: { key: string; subject: string; body: string }) => {
        const { error } = await supabase
          .from('email_templates')
          .update({ subject: input.subject, body: input.body })
          .eq('key', input.key);
        if (error) throw new Error(error.message);
      },
    ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['email-templates'] }),
  });
}

export function useAutomationSettings() {
  return useQuery({
    queryKey: ['email-automation-settings'] as const,
    queryFn: async (): Promise<AutomationSettingRow[]> => {
      const { data, error } = await supabase
        .from('email_automation_settings')
        .select('key, description, enabled')
        .order('key');
      if (error) throw new Error(error.message);
      return (data ?? []) as AutomationSettingRow[];
    },
  });
}

export function useUpdateAutomationSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation(
      'email_automation_settings',
      'update',
      async (input: { key: string; enabled: boolean }) => {
        const { error } = await supabase
          .from('email_automation_settings')
          .update({ enabled: input.enabled })
          .eq('key', input.key);
        if (error) throw new Error(error.message);
      },
    ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['email-automation-settings'] }),
  });
}

export function useEmailSequences() {
  return useQuery({
    queryKey: ['email-sequences'] as const,
    queryFn: async (): Promise<SequenceRow[]> => {
      const { data, error } = await supabase
        .from('email_sequences')
        .select('id, key, display_name, description, enabled, steps:email_sequence_steps(*)')
        .order('key');
      if (error) throw new Error(error.message);
      return ((data ?? []) as SequenceRow[]).map((s) => ({
        ...s,
        steps: [...(s.steps ?? [])].sort((a, b) => a.position - b.position),
      }));
    },
  });
}

export function useUpdateSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation(
      'email_sequences',
      'update',
      async (input: { id: string; enabled: boolean }) => {
        const { error } = await supabase
          .from('email_sequences')
          .update({ enabled: input.enabled })
          .eq('id', input.id);
        if (error) throw new Error(error.message);
      },
    ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['email-sequences'] }),
  });
}

export function useUpdateSequenceStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation(
      'email_sequence_steps',
      'update',
      async (input: { id: string; day_offset?: number; enabled?: boolean }) => {
        const patch: { day_offset?: number; enabled?: boolean } = {};
        if (input.day_offset !== undefined) patch.day_offset = input.day_offset;
        if (input.enabled !== undefined) patch.enabled = input.enabled;
        const { error } = await supabase
          .from('email_sequence_steps')
          .update(patch)
          .eq('id', input.id);
        if (error) throw new Error(error.message);
      },
    ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['email-sequences'] }),
  });
}
