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

describe('SignaturePreview logoUrl prop', () => {
  it('uses the provided https logoUrl in the rendered signature', () => {
    render(
      <SignaturePreview
        person={{ name: 'X', email: 'x@itdev.gr' }}
        logoUrl="https://cdn.example/avatars/u.png?v=1"
      />,
    );
    const doc = screen.getByTitle('signature-preview').getAttribute('srcdoc') ?? '';
    expect(doc).toContain('https://cdn.example/avatars/u.png?v=1');
    expect(doc).not.toContain('/email-assets/itdev-logo-round.png');
  });
  it('falls back to the default logo when logoUrl is null', () => {
    render(<SignaturePreview person={{ name: 'X', email: 'x@itdev.gr' }} logoUrl={null} />);
    const doc = screen.getByTitle('signature-preview').getAttribute('srcdoc') ?? '';
    expect(doc).toContain('/email-assets/itdev-logo-round.png');
  });
});
