import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';

const { mutateAsync, autopayMutateAsync } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  autopayMutateAsync: vi.fn(),
}));

vi.mock('../hooks/useExpenseCategories', () => ({
  useExpenseCategories: () => ({
    data: [{ id: 'cat-1', name_en: 'Software', name_el: 'Λογισμικό' }],
  }),
}));
vi.mock('../hooks/useCreateExpense', () => ({
  useCreateExpense: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('../hooks/useSetExpenseAutopay', () => ({
  useSetExpenseAutopay: () => ({ mutateAsync: autopayMutateAsync, isPending: false }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: 'user-1' } }),
}));

import { NewExpenseDialog } from './NewExpenseDialog';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cat-1' } });
  fireEvent.change(screen.getByLabelText('Amount (net)'), { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: '24%' }));
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-06-01' } });
}

describe('NewExpenseDialog — Save & mark paid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue({ id: 'e1' });
  });

  it('blocks "Save & mark paid" when payment method is empty (DB requires it)', async () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    // payment method left blank
    fireEvent.click(screen.getByRole('button', { name: 'Save & mark paid' }));

    // It must NOT attempt the insert (would 400 on expenses_paid_requires_method).
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('allows "Save & mark paid" once a payment method is provided (after the paid-date field is confirmed)', async () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'Bank' } });
    // First click reveals the paid-date field — does not submit yet.
    fireEvent.click(screen.getByRole('button', { name: 'Save & mark paid' }));
    expect(mutateAsync).not.toHaveBeenCalled();
    // Second click submits.
    fireEvent.click(screen.getByRole('button', { name: 'Save & mark paid' }));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ markPaid: true, paymentMethod: 'Bank' }),
    );
  });

  it('still allows pending "Save" without a payment method', async () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ markPaid: false }));
  });
});

describe('NewExpenseDialog — monthly auto end-date', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue({ id: 'e1' });
  });

  it('lands on the last day of the target month for a month-end start (no overflow)', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    // Switch to a monthly billing period, then pick a month-end start date.
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-01-31' } });

    // Jan 31 + 1 month must clamp to Feb 28, not overflow into March.
    expect((screen.getByLabelText('End date') as HTMLInputElement).value).toBe('2026-02-28');
  });
});

describe('NewExpenseDialog — Autopay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue({ id: 'e1' });
    autopayMutateAsync.mockResolvedValue(1);
  });

  it('hides the autopay toggle for one_time billing', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    expect(screen.queryByLabelText('Autopay')).toBeNull();
  });

  it('shows the autopay toggle for recurring billing', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    expect(screen.getByLabelText('Autopay')).toBeTruthy();
  });

  it('blocks Save when autopay is on but payment method is empty', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    fireEvent.click(screen.getByLabelText('Autopay'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('A payment method is required for autopay')).toBeTruthy();
  });

  it('creates with autopay=true and settles via RPC when method provided', async () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    fireEvent.click(screen.getByLabelText('Autopay'));
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'CARD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('button', { name: 'Save' }); // let async submit settle
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ autopay: true }));
    expect(autopayMutateAsync).toHaveBeenCalledWith({
      id: 'e1',
      enabled: true,
      paymentMethod: 'CARD',
    });
  });

  it('switching back to one_time drops autopay from the payload', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    fireEvent.click(screen.getByLabelText('Autopay'));
    fireEvent.click(screen.getByRole('button', { name: 'One-time' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ autopay: false }));
    expect(autopayMutateAsync).not.toHaveBeenCalled();
  });
});

describe('NewExpenseDialog — explicit VAT choice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue({ id: 'e1' });
  });

  it('blocks submit until a VAT rate is chosen, with the validation message', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    // Fill everything except VAT — no segment clicked.
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cat-1' } });
    fireEvent.change(screen.getByLabelText('Amount (net)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-06-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Choose a VAT rate.')).toBeTruthy();
  });

  it('has no VAT segment preselected', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    const zero = screen.getByRole('button', { name: '0%' });
    const twentyFour = screen.getByRole('button', { name: '24%' });
    expect(zero.className).not.toContain('bg-primary');
    expect(twentyFour.className).not.toContain('bg-primary');
  });

  it('sets vat_rate to 0 when the 0% segment is chosen', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cat-1' } });
    fireEvent.change(screen.getByLabelText('Amount (net)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '0%' }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-06-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ vatRate: 0 }));
  });

  it('sets vat_rate to 24 when the 24% segment is chosen', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ vatRate: 24 }));
  });

  it('opens a numeric input for Custom and sends the typed value', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cat-1' } });
    fireEvent.change(screen.getByLabelText('Amount (net)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Custom VAT rate (%)'), { target: { value: '13' } });
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-06-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ vatRate: 13 }));
  });

  it('blocks submit when Custom is chosen but left empty', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cat-1' } });
    fireEvent.change(screen.getByLabelText('Amount (net)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-06-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Choose a VAT rate.')).toBeTruthy();
  });
});

describe('NewExpenseDialog — paid-by wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue({ id: 'e1' });
  });

  it('includes the current user id as paidByUserId in the create payload', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ paidByUserId: 'user-1' }));
  });
});

describe('NewExpenseDialog — mark-paid date (I1 entry half)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue({ id: 'e1' });
  });

  it('is not shown until "Save & mark paid" is engaged', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    expect(screen.queryByLabelText('Payment date')).toBeNull();
  });

  it('defaults to the expense start date, not today', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields(); // start date 2026-06-01
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'Bank' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & mark paid' }));

    expect((screen.getByLabelText('Payment date') as HTMLInputElement).value).toBe('2026-06-01');
  });

  it('submits the user-edited paid date, not the default', async () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'Bank' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & mark paid' }));
    fireEvent.change(screen.getByLabelText('Payment date'), { target: { value: '2026-06-03' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & mark paid' }));

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ markPaid: true, paidDate: '2026-06-03' }),
    );
  });

  it('omits paidDate entirely for the plain "Save" (pending) path', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ markPaid: false }));
    expect(mutateAsync.mock.calls[0]![0]).not.toHaveProperty('paidDate');
  });
});

describe('NewExpenseDialog — receipt nudge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue({ id: 'e1' });
  });

  it('renders a non-blocking note about saving without a receipt', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    expect(screen.getByText('Saving without a receipt')).toBeTruthy();
  });

  it('does not block submit', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    expect(screen.getByText('Saving without a receipt')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });
});
