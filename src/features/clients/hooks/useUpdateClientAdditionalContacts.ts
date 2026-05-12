import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';
import { queryKeys } from '@/lib/queryKeys';

export type AdditionalContact = {
  full_name: string;
  email: string;
  phone: string;
  info: string;
};

type Input = { clientId: string; contacts: AdditionalContact[] };

export function useUpdateClientAdditionalContacts() {
  const qc = useQueryClient();
  return useMutation<void, Error, Input>({
    mutationFn: captureMutation<Input, void>(
      'clients',
      'update_additional_contacts',
      async ({ clientId, contacts }) => {
        const { error } = await supabase
          .from('clients')
          .update({ additional_contacts: contacts })
          .eq('id', clientId);
        if (error) throw new Error(error.message);
      },
    ),
    onSuccess: (_d, { clientId }) => {
      // Invalidate everywhere the contacts surface: job detail, client detail, jobs-for-deal, etc.
      void qc.invalidateQueries({ queryKey: queryKeys.client(clientId) });
      void qc.invalidateQueries({ queryKey: ['job'] });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
