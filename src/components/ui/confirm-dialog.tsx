import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Question shown as the dialog title, e.g. "Delete this task?" */
  title: string;
  /** Optional supporting copy under the title. A ReactNode so a destructive
   *  action can spell out its real consequences as a list with the actual
   *  figures, not one flat sentence (owner 2026-09-11: "να ξέρει το accounting
   *  τι κάνει και με ποια επίπτωση"). Plain strings still work unchanged. */
  description?: ReactNode;
  /** Label for the destructive action button; defaults to common:confirm. */
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  pending?: boolean;
};

/**
 * Styled replacement for window.confirm() so destructive actions match the
 * rest of the app's dialogs.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending = false,
}: Props) {
  const { t } = useTranslation('common');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {typeof description === 'string' || typeof description === 'number' ? (
            <DialogDescription>{description}</DialogDescription>
          ) : description ? (
            // Radix renders DialogDescription as a <p>; a rich consequence
            // block contains a list, which cannot legally nest inside one.
            // `asChild` hands the description role to a <div> instead — and
            // keeps it the ONE description element, so the title is not
            // duplicated into the accessible name.
            <DialogDescription asChild>
              <div className="text-sm text-muted-foreground">{description}</div>
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button variant="destructive" onClick={() => void onConfirm()} disabled={pending}>
            {confirmLabel ?? t('confirm', { defaultValue: 'Confirm' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
