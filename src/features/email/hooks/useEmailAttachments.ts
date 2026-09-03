import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type EmailAttachmentRow = {
  id: string;
  message_pk: string;
  content_id: string | null;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  is_inline: boolean;
  storage_path: string;
};

/** message_pk -> its attachments. Rows are written by gmail-sync only; RLS
 *  mirrors email_messages, so a viewer who may read the thread may read its
 *  files. One query per rendered thread list, keyed on the message ids. */
export function useEmailAttachments(messageIds: string[]): Map<string, EmailAttachmentRow[]> {
  const key = [...messageIds].sort().join(',');
  const q = useQuery({
    queryKey: ['email-attachments', key] as const,
    enabled: messageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_attachments' as never)
        .select('id, message_pk, content_id, file_name, mime_type, file_size, is_inline, storage_path')
        .in('message_pk', messageIds);
      if (error) throw new Error(error.message);
      return data as unknown as EmailAttachmentRow[];
    },
  });
  const map = new Map<string, EmailAttachmentRow[]>();
  for (const row of q.data ?? []) {
    const list = map.get(row.message_pk);
    if (list) list.push(row);
    else map.set(row.message_pk, [row]);
  }
  return map;
}
