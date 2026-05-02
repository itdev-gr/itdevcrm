import { useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useMentionableUsers, type MentionableUser } from './hooks/useMentionableUsers';
import { useCreateComment } from './hooks/useCreateComment';

type Props = {
  parentType: 'client' | 'deal' | 'job' | 'lead';
  parentId: string;
};

// Match the trigger token at the caret: `@` followed by 0+ name chars, no space.
// Capture group 1 is the partial query (after `@`).
const MENTION_RE = /(?:^|\s)@([\p{L}\p{N}._-]*)$/u;

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMentionToken(user: MentionableUser): string {
  // Token persisted in the comment body. Names with spaces get underscores so
  // the regex below can re-extract them on submit (matches the DB trigger's
  // expectation that mentioned_user_ids carries the resolved IDs).
  return '@' + (user.full_name || user.email).trim().replace(/\s+/g, '_');
}

export function CommentForm({ parentType, parentId }: Props) {
  const { t } = useTranslation('sales');
  const { data: users = [] } = useMentionableUsers();
  const create = useCreateComment();

  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [body, setBody] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const tokenToUserId = useRef<Map<string, string>>(new Map());

  const matches = useMemo<MentionableUser[]>(() => {
    if (query == null) return [];
    const q = query.toLowerCase();
    return users
      .filter(
        (u) =>
          (u.full_name && u.full_name.toLowerCase().includes(q)) ||
          u.email.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [query, users]);

  function refreshQuery(text: string, caret: number) {
    const before = text.slice(0, caret);
    const m = MENTION_RE.exec(before);
    setQuery(m ? (m[1] ?? '') : null);
    setActiveIndex(0);
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    setBody(text);
    refreshQuery(text, e.target.selectionStart ?? text.length);
  }

  function applyMention(user: MentionableUser) {
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart ?? body.length;
    const before = body.slice(0, caret);
    const after = body.slice(caret);
    const m = MENTION_RE.exec(before);
    const start = m ? caret - (m[0].length - (m[0].startsWith('@') ? 0 : 1)) : caret;
    const token = buildMentionToken(user);
    tokenToUserId.current.set(token, user.user_id);
    const next = before.slice(0, start) + token + ' ' + after;
    setBody(next);
    setQuery(null);
    // Restore caret after the inserted token + space.
    queueMicrotask(() => {
      const newCaret = (before.slice(0, start) + token + ' ').length;
      ta.focus();
      ta.setSelectionRange(newCaret, newCaret);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (query == null || matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const pick = matches[activeIndex];
      if (pick) {
        e.preventDefault();
        applyMention(pick);
      }
    } else if (e.key === 'Escape') {
      setQuery(null);
    }
  }

  function resolveMentions(text: string): string[] {
    const ids = new Set<string>();
    // Tokens we generated this session (most reliable).
    for (const [token, id] of tokenToUserId.current.entries()) {
      const re = new RegExp('(?:^|\\s)' + escapeRegex(token) + '(?=\\s|$|[.,!?;:])');
      if (re.test(text)) ids.add(id);
    }
    // Also accept @full_name typed manually (case-insensitive).
    for (const u of users) {
      if (!u.full_name) continue;
      const token = '@' + u.full_name.trim().replace(/\s+/g, '_');
      const re = new RegExp('(?:^|\\s)' + escapeRegex(token) + '(?=\\s|$|[.,!?;:])', 'i');
      if (re.test(text)) ids.add(u.user_id);
    }
    return [...ids];
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    await create.mutateAsync({
      parent_type: parentType,
      parent_id: parentId,
      body: body.trim(),
      mentioned_user_ids: resolveMentions(body),
    });
    setBody('');
    setQuery(null);
    tokenToUserId.current.clear();
  }

  return (
    <form onSubmit={onSubmit} className="relative space-y-2">
      <textarea
        ref={taRef}
        value={body}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={t('comments.placeholder')}
        rows={2}
        className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      {query != null && matches.length > 0 && (
        <ul className="absolute z-30 max-h-56 w-72 overflow-y-auto rounded-md border bg-white text-sm shadow-md">
          {matches.map((u, idx) => (
            <li
              key={u.user_id}
              role="button"
              onMouseDown={(ev) => {
                ev.preventDefault();
                applyMention(u);
              }}
              onMouseEnter={() => setActiveIndex(idx)}
              className={`cursor-pointer px-3 py-2 ${
                idx === activeIndex ? 'bg-slate-100' : 'hover:bg-slate-50'
              }`}
            >
              <div className="font-medium">{u.full_name || u.email}</div>
              <div className="text-xs text-slate-500">
                {u.email}
                {u.is_admin && ' · admin'}
                {u.group_codes.length > 0 && ' · ' + u.group_codes.join(', ')}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={create.isPending || !body.trim()}>
          {t('comments.submit')}
        </Button>
      </div>
    </form>
  );
}
