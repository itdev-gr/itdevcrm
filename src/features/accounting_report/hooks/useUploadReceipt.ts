import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export const MAX_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

function sanitise(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

export function useUploadReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ expenseId, file }: { expenseId: string; file: File }) => {
      if (file.size > MAX_BYTES) {
        throw new Error('File is larger than 10 MB.');
      }
      if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
        throw new Error('Unsupported file type.');
      }
      const path = `${expenseId}/${crypto.randomUUID()}-${sanitise(file.name)}`;
      const { error: upErr } = await supabase.storage
        .from('expense-receipts')
        .upload(path, file, { upsert: false });
      if (upErr) throw new Error(upErr.message);
      const { error: updErr } = await supabase
        .from('expenses')
        .update({ receipt_path: path })
        .eq('id', expenseId)
        .select()
        .single();
      if (updErr) throw new Error(updErr.message);
      return path;
    },
    onSuccess: (_p, vars) => {
      void qc.invalidateQueries({ queryKey: ['expense', vars.expenseId] });
      void qc.invalidateQueries({ queryKey: ['expenses'] });
    },
  });
}
