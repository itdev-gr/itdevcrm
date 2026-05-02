import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBlockClient } from './hooks/useBlockClient';

type Props = { open: boolean; onOpenChange: (v: boolean) => void; clientId: string };

export function BlockClientDialog({ open, onOpenChange, clientId }: Props) {
  const { t } = useTranslation('accounting');
  const block = useBlockClient();
  const [reason, setReason] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    try {
      await block.mutateAsync({ clientId, reason: reason.trim() });
      onOpenChange(false);
      setReason('');
    } catch (err) {
      const msg = (err as Error).message;
      alert(t(`block.errors.${msg}`, { defaultValue: msg }));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('block.dialog_title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="reason">{t('block.dialog_body')}</Label>
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('block.cancel')}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={block.isPending || !reason.trim()}
            >
              {t('block.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
