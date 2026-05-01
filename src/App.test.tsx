import { render, screen } from '@testing-library/react';
import '@/lib/i18n';
import { HomePage } from './app/routes/HomePage';

describe('HomePage', () => {
  it('renders the heading', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: /itdevcrm/i })).toBeInTheDocument();
  });
});
