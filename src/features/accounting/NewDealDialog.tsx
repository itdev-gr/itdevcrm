import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ClientPicker, type PickedClient } from '@/features/clients/ClientPicker';
import { useCreateAccountingDeal } from './hooks/useCreateAccountingDeal';
import {
  validateNewDeal,
  buildCreateDealParams,
  type NewDealInput,
  type NewDealClientMode,
} from './newDeal';

type Props = { open: boolean; onClose: () => void };

export function NewDealDialog({ open, onClose }: Props) {
  const { t } = useTranslation('accounting');
  const navigate = useNavigate();
  const create = useCreateAccountingDeal();

  const [mode, setMode] = useState<NewDealClientMode>('existing');
  const [client, setClient] = useState<PickedClient | null>(null);
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [title, setTitle] = useState('');
  const [oneTime, setOneTime] = useState('');
  const [monthly, setMonthly] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'' | 'cash' | 'online'>('');
  const [cashChargeVat, setCashChargeVat] = useState(false);
  const [description, setDescription] = useState('');

  function reset() {
    setMode('existing');
    setClient(null);
    setNewClientName('');
    setNewClientEmail('');
    setNewClientPhone('');
    setTitle('');
    setOneTime('');
    setMonthly('');
    setPaymentMethod('');
    setCashChargeVat(false);
    setDescription('');
  }

  function close() {
    reset();
    onClose();
  }

  function buildInput(): NewDealInput {
    return {
      mode,
      existingClientId: client?.id ?? null,
      newClientName,
      newClientEmail,
      newClientPhone,
      title,
      oneTime: Number(oneTime) || 0,
      monthly: Number(monthly) || 0,
      paymentMethod,
      cashChargeVat,
      description,
    };
  }

  function showErrors(keys: string[]) {
    alert(keys.map((k) => t(`new_deal.errors.${k}`, { defaultValue: k })).join('\n'));
  }

  function onSubmit() {
    const input = buildInput();
    const errs = validateNewDeal(input);
    if (errs.length > 0) {
      showErrors(errs);
      return;
    }
    create.mutate(buildCreateDealParams(input), {
      onSuccess: (r) => {
        reset();
        onClose();
        navigate(`/deals/${r.deal_id}`);
      },
      onError: (err) => {
        const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
        showErrors(errors);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('new_deal.title')}</DialogTitle>
          <DialogDescription>{t('new_deal.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === 'existing' ? 'default' : 'outline'}
              onClick={() => setMode('existing')}
            >
              {t('new_deal.existing_client')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'new' ? 'default' : 'outline'}
              onClick={() => setMode('new')}
            >
              {t('new_deal.new_client')}
            </Button>
          </div>

          {mode === 'existing' ? (
            <ClientPicker value={client} onChange={setClient} id="new-deal-client" />
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="nc-name">{t('new_deal.client_name')}</Label>
                <Input
                  id="nc-name"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="nc-email">{t('new_deal.client_email')}</Label>
                  <Input
                    id="nc-email"
                    value={newClientEmail}
                    onChange={(e) => setNewClientEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nc-phone">{t('new_deal.client_phone')}</Label>
                  <Input
                    id="nc-phone"
                    value={newClientPhone}
                    onChange={(e) => setNewClientPhone(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="nd-title">{t('new_deal.deal_title')}</Label>
            <Input id="nd-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nd-onetime">{t('new_deal.one_time')}</Label>
              <Input
                id="nd-onetime"
                type="number"
                min="0"
                value={oneTime}
                onChange={(e) => setOneTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nd-monthly">{t('new_deal.monthly')}</Label>
              <Input
                id="nd-monthly"
                type="number"
                min="0"
                value={monthly}
                onChange={(e) => setMonthly(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nd-pm">{t('new_deal.payment_method')}</Label>
            <select
              id="nd-pm"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as '' | 'cash' | 'online')}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              <option value="">{t('new_deal.payment_none')}</option>
              <option value="cash">{t('new_deal.payment_cash')}</option>
              <option value="online">{t('new_deal.payment_online')}</option>
            </select>
            {paymentMethod === 'cash' && (
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={cashChargeVat}
                  onChange={(e) => setCashChargeVat(e.target.checked)}
                />
                {t('new_deal.cash_charge_vat', { defaultValue: 'Χρέωση ΦΠΑ (μετρητά)' })}
              </label>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nd-desc">{t('new_deal.notes')}</Label>
            <Input id="nd-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={create.isPending}>
            {t('new_deal.cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={create.isPending}>
            {create.isPending ? t('new_deal.submitting') : t('new_deal.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
