import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/lib/i18n';
import { LocaleSwitcher } from './LocaleSwitcher';
import { i18n } from '@/lib/i18n';

describe('LocaleSwitcher', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders with current language', () => {
    render(<LocaleSwitcher />);
    expect(screen.getByLabelText(/language/i)).toBeInTheDocument();
  });

  it('changes language when user selects Greek', async () => {
    const user = userEvent.setup();
    render(<LocaleSwitcher />);
    await user.click(screen.getByLabelText(/language/i));
    await user.click(screen.getByText('Ελληνικά'));
    expect(i18n.language).toBe('el');
  });
});
