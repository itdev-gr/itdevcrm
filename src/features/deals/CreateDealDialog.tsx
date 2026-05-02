import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DealForm } from './DealForm';

type Props = { open: boolean; onOpenChange: (v: boolean) => void; clientId?: string };

export function CreateDealDialog({ open, onOpenChange, clientId }: Props) {
  const { t } = useTranslation('deals');
  const navigate = useNavigate();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('new_deal')}</DialogTitle>
        </DialogHeader>
        <DealForm
          {...(clientId !== undefined ? { defaultClientId: clientId } : {})}
          onDone={(id) => {
            onOpenChange(false);
            navigate(`/deals/${id}`);
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
