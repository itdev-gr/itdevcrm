import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { ServicePackageRow } from './useServicePackages';
import type { ServiceSubpackageRow } from './useServiceSubpackages';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useToggleServicePackageActive() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, { id: string; is_active: boolean }, { previous: [readonly unknown[], ServicePackageRow[] | undefined][] }>({
    mutationFn: captureMutation('service_packages', 'toggle_active', async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('service_packages')
        .update({ is_active })
        .eq('id', id);
      if (error) throw new Error(error.message);
    }),
    onMutate: async ({ id, is_active }) => {
      await qc.cancelQueries({ queryKey: queryKeys.servicePackages() });
      const previous = qc.getQueriesData<ServicePackageRow[]>({
        queryKey: queryKeys.servicePackages(),
      });
      qc.setQueriesData<ServicePackageRow[]>(
        { queryKey: queryKeys.servicePackages() },
        (old) => old?.map((p) => (p.id === id ? { ...p, is_active } : p)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        for (const [key, data] of ctx.previous) {
          qc.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.servicePackages() });
    },
  });
}

export function useToggleSubpackageActive(parentId: string) {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, { id: string; is_active: boolean }, { previous: ServiceSubpackageRow[] | undefined }>({
    mutationFn: captureMutation('service_packages', 'toggle_subpackage_active', async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('service_subpackages')
        .update({ is_active })
        .eq('id', id);
      if (error) throw new Error(error.message);
    }),
    onMutate: async ({ id, is_active }) => {
      const key = queryKeys.serviceSubpackages(parentId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ServiceSubpackageRow[]>(key);
      qc.setQueryData<ServiceSubpackageRow[]>(
        key,
        (old) => old?.map((p) => (p.id === id ? { ...p, is_active } : p)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(queryKeys.serviceSubpackages(parentId), ctx.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.serviceSubpackages(parentId) });
    },
  });
}
