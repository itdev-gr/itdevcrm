export type NewDealClientMode = 'existing' | 'new';

export type NewDealInput = {
  mode: NewDealClientMode;
  existingClientId: string | null;
  newClientName: string;
  newClientEmail: string;
  newClientPhone: string;
  title: string;
  oneTime: number;
  monthly: number;
  paymentMethod: '' | 'cash' | 'online';
  cashChargeVat: boolean;
  description: string;
};

export type NewDealError =
  | 'missing_client'
  | 'missing_client_name'
  | 'missing_title'
  | 'invalid_amount';

export type CreateDealParams = {
  p_client_id: string | null;
  p_new_client: Record<string, string> | null;
  p_title: string;
  p_one_time: number;
  p_monthly: number;
  p_payment_method: string | null;
  p_cash_charge_vat: boolean;
  p_description: string | null;
};

export function validateNewDeal(input: NewDealInput): NewDealError[] {
  const errors: NewDealError[] = [];
  if (input.mode === 'existing' && !input.existingClientId) errors.push('missing_client');
  if (input.mode === 'new' && input.newClientName.trim() === '') errors.push('missing_client_name');
  if (input.title.trim() === '') errors.push('missing_title');
  if (input.oneTime < 0 || input.monthly < 0) errors.push('invalid_amount');
  return errors;
}

export function buildCreateDealParams(input: NewDealInput): CreateDealParams {
  const newClient =
    input.mode === 'new'
      ? {
          name: input.newClientName.trim(),
          ...(input.newClientEmail.trim() ? { email: input.newClientEmail.trim() } : {}),
          ...(input.newClientPhone.trim() ? { phone: input.newClientPhone.trim() } : {}),
        }
      : null;
  return {
    p_client_id: input.mode === 'existing' ? input.existingClientId : null,
    p_new_client: newClient,
    p_title: input.title.trim(),
    p_one_time: input.oneTime,
    p_monthly: input.monthly,
    p_payment_method: input.paymentMethod === '' ? null : input.paymentMethod,
    p_cash_charge_vat: input.paymentMethod === 'cash' ? input.cashChargeVat : false,
    p_description: input.description.trim() ? input.description.trim() : null,
  };
}
