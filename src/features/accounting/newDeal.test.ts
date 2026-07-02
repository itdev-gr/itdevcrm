import { describe, it, expect } from 'vitest';
import { validateNewDeal, buildCreateDealParams, type NewDealInput } from './newDeal';

const base: NewDealInput = {
  mode: 'existing',
  existingClientId: 'c-1',
  newClientName: '',
  newClientEmail: '',
  newClientPhone: '',
  title: 'My deal',
  oneTime: 0,
  monthly: 0,
  paymentMethod: '',
  cashChargeVat: false,
  description: '',
};

describe('validateNewDeal', () => {
  it('passes for a valid existing-client deal', () => {
    expect(validateNewDeal(base)).toEqual([]);
  });

  it('requires an existing client when mode=existing', () => {
    expect(validateNewDeal({ ...base, existingClientId: null })).toEqual(['missing_client']);
  });

  it('requires a name when mode=new', () => {
    const input = { ...base, mode: 'new' as const, existingClientId: null, newClientName: '  ' };
    expect(validateNewDeal(input)).toEqual(['missing_client_name']);
  });

  it('passes for a valid new-client deal', () => {
    const input = { ...base, mode: 'new' as const, existingClientId: null, newClientName: 'Acme' };
    expect(validateNewDeal(input)).toEqual([]);
  });

  it('requires a non-blank title', () => {
    expect(validateNewDeal({ ...base, title: '   ' })).toEqual(['missing_title']);
  });

  it('rejects negative amounts', () => {
    expect(validateNewDeal({ ...base, oneTime: -1 })).toEqual(['invalid_amount']);
  });
});

describe('buildCreateDealParams', () => {
  it('maps an existing-client deal to RPC params', () => {
    expect(buildCreateDealParams({ ...base, paymentMethod: 'online', monthly: 49 })).toEqual({
      p_client_id: 'c-1',
      p_new_client: null,
      p_title: 'My deal',
      p_one_time: 0,
      p_monthly: 49,
      p_payment_method: 'online',
      p_cash_charge_vat: false,
      p_description: null,
    });
  });

  it('passes cashChargeVat only when payment method is cash', () => {
    expect(
      buildCreateDealParams({ ...base, paymentMethod: 'cash', cashChargeVat: true }),
    ).toMatchObject({ p_payment_method: 'cash', p_cash_charge_vat: true });
    // Non-cash never charges the cash-VAT flag, even if it's set.
    expect(
      buildCreateDealParams({ ...base, paymentMethod: 'online', cashChargeVat: true }),
    ).toMatchObject({ p_payment_method: 'online', p_cash_charge_vat: false });
  });

  it('maps a new-client deal, omitting blank optional contact fields', () => {
    const input = {
      ...base,
      mode: 'new' as const,
      existingClientId: null,
      newClientName: '  Acme  ',
      newClientEmail: 'a@b.gr',
      newClientPhone: '',
      title: '  Deal  ',
      description: '  note ',
    };
    expect(buildCreateDealParams(input)).toEqual({
      p_client_id: null,
      p_new_client: { name: 'Acme', email: 'a@b.gr' },
      p_title: 'Deal',
      p_one_time: 0,
      p_monthly: 0,
      p_payment_method: null,
      p_cash_charge_vat: false,
      p_description: 'note',
    });
  });
});
