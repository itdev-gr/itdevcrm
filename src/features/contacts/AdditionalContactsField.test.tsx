import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdditionalContactsField } from './AdditionalContactsField';

describe('AdditionalContactsField', () => {
  it('shows a saved contact in view mode with a click-to-call phone', () => {
    render(
      <AdditionalContactsField
        value={[{ full_name: 'Bob', email: '', phone: '6912345678', info: '' }]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('link', { name: /6912345678/ })).toHaveAttribute('href', 'tel:+306912345678');
  });
  it('adds a new row that starts in edit mode', async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    render(<AdditionalContactsField value={[]} onChange={onChange} />);
    await u.click(screen.getByRole('button', { name: /Add contact/ }));
    expect(onChange).toHaveBeenCalledWith([{ full_name: '', email: '', phone: '', info: '' }]);
  });
});
