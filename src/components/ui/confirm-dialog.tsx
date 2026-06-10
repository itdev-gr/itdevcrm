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
  /** Optional supporting copy under the title. */
  description?: string;
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
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
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
