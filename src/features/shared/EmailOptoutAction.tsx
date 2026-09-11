import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuthStore } from '@/lib/stores/authStore';
import { useAdminSuppressEmail } from '@/features/email_marketing/hooks/useSuppressions';
import type { EmailOptoutState } from './EmailOptoutBadge';

/**
 * "Do not email this person again" — the action, from the card the salesperson
 * is already looking at.
 *
 * The case it exists for: someone replies «σταματήστε να μου στέλνετε» or says
 * it on the phone. Before this, the only way in was the suppressions page in
 * another section, with the address copy-pasted by hand.
 *
 * Admin-only (it is the same admin_suppress_email RPC, which re-checks
 * server-side) and the reason is mandatory, because taking the decision away
 * from the automation deserves a record: it lands in email_suppression_audit
 * with who did it. Hidden once the person is already on the list — the badge
 * says so there.
 */
export function EmailOptoutAction({
  email,
  state,
  onDone,
  className,
}: {
  email: string | null | undefined;
  state: EmailOptoutState;
  onDone?: () => void;
  className?: string;
}) {
  const { t } = useTranslation('leads');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const suppress = useAdminSuppressEmail();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const address = (email ?? '').trim();
  if (!isAdmin || !address || state === 'refused') return null;

  async function confirm() {
    setError(null);
    try {
      await suppress.mutateAsync({ email: address, note: note.trim(), reason: 'unsubscribed' });
      setOpen(false);
      setNote('');
      onDone?.();
    } catch {
      setError(t('optout.action.failed'));
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={className}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <BellOff className="size-3.5" />
        {t('optout.action.button')}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('optout.action.title', { email: address })}</DialogTitle>
            <DialogDescription>{error ?? t('optout.action.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="optout-note">{t('optout.action.note_label')}</Label>
            <Input
              id="optout-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('optout.action.note_placeholder')}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('optout.action.cancel')}
            </Button>
            <Button disabled={!note.trim() || suppress.isPending} onClick={confirm}>
              {t('optout.action.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
