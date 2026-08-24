import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommissionWidget } from './CommissionWidget';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

const useMyCommission = vi.fn();
vi.mock('./hooks/useMyCommission', () => ({
  useMyCommission: () => useMyCommission(),
}));

const salesperson = {
  found: true,
  role: 'salesperson',
  month: 8,
  year: 2026,
  sales_amount: 1200,
  packages: 4,
  commission: 276,
  setup_fees: 100,
  total_earnings: 376,
  bonuses: 200,
};

describe('CommissionWidget', () => {
  it('renders the month total for a salesperson', () => {
    useMyCommission.mockReturnValue({ data: salesperson });
    render(<CommissionWidget />);
    // el-GR currency formatting: 376,00 €
    expect(screen.getByText(/376,00/)).toBeInTheDocument();
  });

  it('renders nothing without a sales-app profile', () => {
    useMyCommission.mockReturnValue({ data: { found: false } });
    const { container } = render(<CommissionWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while loading', () => {
    useMyCommission.mockReturnValue({ data: undefined });
    const { container } = render(<CommissionWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hides an admin with zero earnings, shows an admin with earnings', () => {
    useMyCommission.mockReturnValue({
      data: { ...salesperson, role: 'admin', total_earnings: 0, bonuses: 0 },
    });
    const { container } = render(<CommissionWidget />);
    expect(container).toBeEmptyDOMElement();

    useMyCommission.mockReturnValue({ data: { ...salesperson, role: 'admin' } });
    render(<CommissionWidget />);
    expect(screen.getByText(/376,00/)).toBeInTheDocument();
  });
});
