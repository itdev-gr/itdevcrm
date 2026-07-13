import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SignaturePreview } from './SignaturePreview';

describe('SignaturePreview', () => {
  it('renders the signature HTML for the given person into the iframe', () => {
    render(
      <SignaturePreview
        person={{ name: 'Maria Kifokeri', title: 'Sales', phone: '+30 694', email: 'm@itdev.gr' }}
      />,
    );
    const frame = screen.getByTitle('signature-preview');
    const doc = frame.getAttribute('srcdoc') ?? '';
    expect(doc).toContain('Maria Kifokeri');
    expect(doc).toContain('Με εκτίμηση,');
    expect(doc).toContain('ΑΠΟΠΟΙΗΣΗ ΕΥΘΥΝΗΣ');
    expect(doc).toContain('/email-assets/itdev-logo-round.png');
  });
});
