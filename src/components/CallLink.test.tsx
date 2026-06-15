import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CallLink } from './CallLink';

describe('CallLink', () => {
  it('renders a tel: anchor for a dialable number', () => {
    render(<CallLink phone="691 234 5678" />);
    const link = screen.getByRole('link', { name: /691 234 5678/ });
    expect(link).toHaveAttribute('href', 'tel:6912345678');
  });

  it('renders a plain placeholder when there is nothing to dial', () => {
    render(<CallLink phone={null} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
