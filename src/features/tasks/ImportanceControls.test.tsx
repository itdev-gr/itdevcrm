import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { ImportanceBadge } from './ImportanceBadge';
import { ImportanceSelect } from './ImportanceSelect';

describe('ImportanceBadge', () => {
  it('renders the importance label', () => {
    render(<ImportanceBadge importance="urgent" />);
    expect(screen.getByText('importance.urgent')).toBeInTheDocument();
  });
});

describe('ImportanceSelect', () => {
  it('shows a disabled placeholder + the four options and reports changes', () => {
    const onChange = vi.fn();
    render(<ImportanceSelect id="imp" value="" onChange={onChange} />);
    expect(screen.getByText('importance.placeholder')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'importance.low' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'importance.urgent' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'high' } });
    expect(onChange).toHaveBeenCalledWith('high');
  });
});
