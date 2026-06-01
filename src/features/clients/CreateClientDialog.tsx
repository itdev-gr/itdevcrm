import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ClientForm } from './ClientForm';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (id: string) => void;
};

export function CreateClientDialog({ open, onOpenChange, onCreated }: Props) {
  const { t } = useTranslation('clients');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('new_client')}</DialogTitle>
          <DialogDescription className="sr-only">{t('new_client_description')}</DialogDescription>
        </DialogHeader>
        <ClientForm
          onDone={(id) => {
            onOpenChange(false);
            onCreated?.(id);
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
