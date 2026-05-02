import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUsers } from '@/features/users/hooks/useUsers';
import { useCreateComment } from './hooks/useCreateComment';

type Props = {
  parentType: 'client' | 'deal' | 'job';
  parentId: string;
};

export function CommentForm({ parentType, parentId }: Props) {
  const { t } = useTranslation('sales');
  const { data: users = [] } = useUsers();
  const create = useCreateComment();
  const [body, setBody] = useState('');

  function parseMentions(text: string): string[] {
    const matches = text.matchAll(/@([\w.+-]+@[\w-]+\.[\w.-]+)/g);
    const emails = new Set<string>();
    for (const m of matches) {
      if (m[1]) emails.add(m[1]);
    }
    return users.filter((u) => emails.has(u.email)).map((u) => u.user_id);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    await create.mutateAsync({
      parent_type: parentType,
      parent_id: parentId,
      body: body.trim(),
      mentioned_user_ids: parseMentions(body),
    });
    setBody('');
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <Input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t('comments.placeholder')}
      />
      <Button type="submit" disabled={create.isPending || !body.trim()}>
        {t('comments.submit')}
      </Button>
    </form>
  );
}
