import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeAll } from 'vitest';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { EmailOptoutBadge } from './EmailOptoutBadge';

describe('EmailOptoutBadge', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });

  it('renders nothing when the address is fine', () => {
    const { container } = render(<EmailOptoutBadge state={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an unknown state rather than an empty pill', () => {
    const { container } = render(<EmailOptoutBadge state={'something_else' as never} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says the person refused when they asked us to stop', () => {
    render(<EmailOptoutBadge state="refused" />);
    const pill = screen.getByText('Δεν θέλει email');
    expect(pill).toBeInTheDocument();
    expect(pill.closest('[data-optout-state]')).toHaveAttribute('data-optout-state', 'refused');
  });

  it('says the address is broken for a bounce — never conflated with a refusal', () => {
    // 407 leads are undeliverable vs 4 refused: showing "does not want email"
    // for a dead mailbox would be wrong about almost everyone on the list.
    render(<EmailOptoutBadge state="undeliverable" />);
    expect(screen.getByText('Το email δεν δουλεύει')).toBeInTheDocument();
    expect(screen.queryByText('Δεν θέλει email')).not.toBeInTheDocument();
  });
});
