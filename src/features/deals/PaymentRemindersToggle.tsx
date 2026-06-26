import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { autoSaveLabel, useAutoSave } from '@/lib/autosave';

type Props = {
  dealId: string;
  initial: boolean;
  canEdit: boolean;
};

export function PaymentRemindersToggle({ dealId, initial, canEdit }: Props) {
  const { t, i18n } = useTranslation('deals');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const qc = useQueryClient();
  const [suppress, setSuppress] = useState(initial);

  const status = useAutoSave(suppress, async (next) => {
    const { error } = await supabase
      .from('deals')
      .update({ suppress_payment_reminders: next })
      .eq('id', dealId);
    if (error) throw new Error(error.message);
    void qc.invalidateQueries({ queryKey: queryKeys.deal(dealId) });
    void qc.invalidateQueries({ queryKey: queryKeys.deals() });
    void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
  });

  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id="suppress-payment-reminders"
        checked={suppress}
        disabled={!canEdit}
        onCheckedChange={(v) => setSuppress(v === true)}
        className="mt-0.5"
      />
      <div className="min-w-0 space-y-1">
        <Label htmlFor="suppress-payment-reminders" className="font-medium">
          {t('reminders.suppress_label')}
        </Label>
        <p className="text-xs text-muted-foreground">{t('reminders.suppress_hint')}</p>
        <div className="h-4 text-xs text-muted-foreground">{autoSaveLabel(status, lang)}</div>
      </div>
    </div>
  );
}
