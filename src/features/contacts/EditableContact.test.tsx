import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditableContact } from './EditableContact';

const val = { full_name: 'Maria P', email: 'maria@acme.gr', phone: '6912345678', info: 'CEO' };

describe('EditableContact', () => {
  it('view mode shows phone as tel: and email as mailto:', () => {
    render(<EditableContact value={val} onChange={() => {}} />);
    expect(screen.getByRole('link', { name: /6912345678/ })).toHaveAttribute('href', 'tel:+306912345678');
    expect(screen.getByRole('link', { name: 'maria@acme.gr' })).toHaveAttribute('href', 'mailto:maria@acme.gr');
  });
  it('edit button reveals inputs; Done returns to view', async () => {
    const u = userEvent.setup();
    render(<EditableContact value={val} onChange={() => {}} />);
    await u.click(screen.getByLabelText('Edit contact'));
    expect(screen.getByDisplayValue('Maria P')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /Done/ }));
    expect(screen.getByRole('link', { name: /6912345678/ })).toBeInTheDocument();
  });
  it('hides the edit button when disabled', () => {
    render(<EditableContact value={val} onChange={() => {}} disabled />);
    expect(screen.queryByLabelText('Edit contact')).toBeNull();
  });
});
