import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

/**
 * Data hooks for the accounting AI assistant. The ai_chat_* tables are not in
 * the generated Supabase types yet, so calls cast with `as never` — the same
 * pattern as useJobIntake for as-yet-untyped tables. RLS scopes everything to
 * the logged-in user's own conversations.
 */

export type AiConversation = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type AiMessage = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_payload: { tools_used?: string[] } | null;
  created_at: string;
};

export function useAiConversations() {
  return useQuery({
    queryKey: queryKeys.aiChatConversations(),
    queryFn: async (): Promise<AiConversation[]> => {
      const { data, error } = await supabase
        .from('ai_chat_conversations' as never)
        .select('id, title, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(30);
      if (error) throw new Error(error.message);
      return (data as unknown as AiConversation[]) ?? [];
    },
  });
}

export function useAiMessages(conversationId: string | null) {
  return useQuery({
    queryKey: queryKeys.aiChatMessages(conversationId ?? 'none'),
    enabled: !!conversationId,
    queryFn: async (): Promise<AiMessage[]> => {
      const { data, error } = await supabase
        .from('ai_chat_messages' as never)
        .select('id, conversation_id, role, content, tool_payload, created_at')
        .eq('conversation_id', conversationId!)
        .in('role', ['user', 'assistant'])
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data as unknown as AiMessage[]) ?? [];
    },
  });
}

export type SendResult = { conversation_id: string; reply: string; tools_used: string[] };

export function useSendChatMessage() {
  const qc = useQueryClient();
  return useMutation<SendResult, Error, { conversationId: string | null; message: string }>({
    mutationFn: captureMutation('ai_chat', 'send', async ({ conversationId, message }) => {
      const { data, error } = await supabase.functions.invoke('accounting-chat', {
        body: { conversation_id: conversationId ?? undefined, message },
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
          // fall back to error.message
        }
        throw new Error(msg);
      }
      return data as SendResult;
    }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: queryKeys.aiChatConversations() });
      void qc.invalidateQueries({ queryKey: queryKeys.aiChatMessages(res.conversation_id) });
    },
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: captureMutation('ai_chat', 'delete_conversation', async (id: string) => {
      const { error } = await supabase
        .from('ai_chat_conversations' as never)
        .delete()
        .eq('id', id);
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.aiChatConversations() }),
  });
}
