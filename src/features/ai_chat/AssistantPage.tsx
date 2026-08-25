import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-shell';
import { useDocumentTitle } from '@/lib/documentTitle';
import {
  useAiConversations,
  useAiMessages,
  useSendChatMessage,
  useDeleteConversation,
  type AiMessage,
} from './hooks/useAiChat';

/** Minimal renderer: newlines + **bold** (no markdown dependency). */
function renderContent(text: string): ReactNode[] {
  return text.split('\n').map((line, i) => {
    const parts = line.split(/\*\*(.+?)\*\*/g);
    return (
      <p key={i} className="min-h-[0.5rem]">
        {parts.map((p, j) => (j % 2 === 1 ? <strong key={j}>{p}</strong> : p))}
      </p>
    );
  });
}

function Bubble({ msg }: { msg: AiMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? 'bg-[#1a9696]/15 text-foreground'
            : 'border border-border/70 bg-card text-foreground'
        }`}
      >
        {renderContent(msg.content)}
      </div>
    </div>
  );
}

const QUICK_PROMPTS_KEYS = ['overdue', 'week', 'alerts', 'client'] as const;

export function AssistantPage() {
  const { t } = useTranslation('accounting');
  useDocumentTitle(t('assistant.title', { defaultValue: 'Βοηθός AI' }));

  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const conversations = useAiConversations();
  const messages = useAiMessages(activeId);
  const send = useSendChatMessage();
  const del = useDeleteConversation();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.data?.length, send.isPending]);

  const submit = (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || send.isPending) return;
    setInput('');
    send.mutate(
      { conversationId: activeId, message },
      { onSuccess: (res) => setActiveId(res.conversation_id) },
    );
  };

  const quickPrompts: Record<(typeof QUICK_PROMPTS_KEYS)[number], string> = {
    overdue: t('assistant.quick.overdue', { defaultValue: 'Ποιοι πελάτες είναι ληξιπρόθεσμοι;' }),
    week: t('assistant.quick.week', { defaultValue: 'Τι πληρωμές λήγουν αυτή την εβδομάδα;' }),
    alerts: t('assistant.quick.alerts', { defaultValue: 'Ποια alerts είναι ανοιχτά;' }),
    client: t('assistant.quick.client', { defaultValue: 'Τι γίνεται με τον πελάτη ' }),
  };

  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col">
      <PageHeader
        title={t('assistant.title', { defaultValue: 'Βοηθός AI' })}
        description={t('assistant.subtitle', {
          defaultValue: 'Ρώτησε οτιδήποτε για πελάτες, πληρωμές και οφειλές — απαντά από τα πραγματικά στοιχεία.',
        })}
      />
      <div className="mt-4 flex min-h-0 flex-1 gap-4">
        {/* Conversations */}
        <aside className="hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto md:flex">
          <button
            type="button"
            onClick={() => setActiveId(null)}
            className="mb-1 flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-2 text-sm hover:bg-muted"
          >
            <Plus className="size-4" />
            {t('assistant.new_chat', { defaultValue: 'Νέα συνομιλία' })}
          </button>
          {(conversations.data ?? []).map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-1 rounded-lg px-3 py-2 text-sm cursor-pointer ${
                c.id === activeId ? 'bg-muted font-medium' : 'hover:bg-muted/60 text-muted-foreground'
              }`}
              onClick={() => setActiveId(c.id)}
            >
              <span className="min-w-0 flex-1 truncate">{c.title ?? '—'}</span>
              <button
                type="button"
                aria-label={t('assistant.delete', { defaultValue: 'Διαγραφή' })}
                className="hidden text-muted-foreground hover:text-red-600 group-hover:block"
                onClick={(e) => {
                  e.stopPropagation();
                  del.mutate(c.id);
                  if (c.id === activeId) setActiveId(null);
                }}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </aside>

        {/* Transcript */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-border/70 bg-background">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {!activeId && (messages.data ?? []).length === 0 && !send.isPending && (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <Sparkles className="size-8 text-[#1a9696]" />
                <p className="max-w-sm text-sm text-muted-foreground">
                  {t('assistant.empty', {
                    defaultValue: 'Ρώτησέ με για οποιονδήποτε πελάτη, τις οφειλές του, ή τη γενική εικόνα του λογιστηρίου.',
                  })}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {QUICK_PROMPTS_KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      className="rounded-full border border-border/70 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                      onClick={() => (k === 'client' ? setInput(quickPrompts[k]) : submit(quickPrompts[k]))}
                    >
                      {quickPrompts[k]}
                      {k === 'client' ? '…' : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(messages.data ?? []).map((m) => (
              <Bubble key={m.id} msg={m} />
            ))}
            {send.isPending && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {t('assistant.thinking', { defaultValue: 'Ψάχνω στα στοιχεία…' })}
              </div>
            )}
            {send.isError && (
              <p className="text-xs text-red-600 dark:text-red-400">{send.error.message}</p>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          <div className="border-t border-border/60 p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={2}
                placeholder={t('assistant.placeholder', { defaultValue: 'Γράψε την ερώτησή σου…' })}
                aria-label={t('assistant.placeholder', { defaultValue: 'Γράψε την ερώτησή σου…' })}
                className="min-h-[3rem] w-full resize-none rounded-lg border border-border/70 bg-background px-3 py-2 text-sm focus:outline-none"
              />
              <button
                type="button"
                onClick={() => submit()}
                disabled={send.isPending || !input.trim()}
                className="rounded-lg bg-primary px-4 py-2.5 text-sm text-primary-foreground disabled:opacity-50"
              >
                {t('assistant.send', { defaultValue: 'Αποστολή' })}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
