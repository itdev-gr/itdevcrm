import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type Target = { type: 'lead' | 'client'; id: string; label: string; sub: string };
type Props = { messagePk: string | null; fromEmail: string; onClose: () => void; onFiled: () => void };

export function FileEmailDialog({ messagePk, fromEmail, onClose, onFiled }: Props) {
  const { t } = useTranslation('sales');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Target[]>([]);
  const [picked, setPicked] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = !!messagePk;

  useEffect(() => {
    setQ(''); setResults([]); setPicked(null); setError(null);
  }, [messagePk]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    const h = window.setTimeout(async () => {
      const like = `%${term.replace(/[%_]/g, '\\$&')}%`;
      const [leads, clients] = await Promise.all([
        supabase.from('leads').select('id, title, code, email')
          .or(`title.ilike.${like},code.ilike.${like},email.ilike.${like}`)
          .eq('archived', false).limit(6),
        supabase.from('clients').select('id, name, code, email')
          .or(`name.ilike.${like},code.ilike.${like},email.ilike.${like}`)
          .limit(6),
      ]);
      setResults([
        ...(leads.data ?? []).map((l) => ({
          type: 'lead' as const, id: l.id as string,
          label: (l.title as string) || (l.email as string) || '—',
          sub: `${t('inbox.card.lead')} · ${l.code ?? ''}`,
        })),
        ...(clients.data ?? []).map((c) => ({
          type: 'client' as const, id: c.id as string,
          label: (c.name as string) || (c.email as string) || '—',
          sub: `${t('inbox.card.client')} · ${c.code ?? ''}`,
        })),
      ]);
    }, 250);
    return () => window.clearTimeout(h);
  }, [q, t]);

  async function onConfirm() {
    if (!messagePk || !picked) return;
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc('file_email_message' as never, {
      p_message_pk: messagePk, p_target_type: picked.type, p_target_id: picked.id,
    } as never);
    setBusy(false);
    if (e) { setError(e.message); return; }
    onFiled();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('inbox.file_title')}</DialogTitle>
          <DialogDescription>{t('inbox.file_description', { email: fromEmail })}</DialogDescription>
        </DialogHeader>
        <Input autoFocus placeholder={t('inbox.file_search_placeholder')} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {results.map((r) => (
            <button
              key={`${r.type}:${r.id}`}
              type="button"
              onClick={() => setPicked(r)}
              className={cn(
                'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm',
                picked?.id === r.id && picked.type === r.type ? 'border-primary/50 bg-primary/10' : 'border-border hover:bg-muted',
              )}
            >
              <span className="truncate">{r.label}</span>
              <span className="ml-2 shrink-0 text-xs text-muted-foreground">{r.sub}</span>
            </button>
          ))}
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('inbox.file_cancel')}</Button>
          <Button onClick={() => void onConfirm()} disabled={!picked || busy}>
            {busy ? '…' : t('inbox.file_confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
