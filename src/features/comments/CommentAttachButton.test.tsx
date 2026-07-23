import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { CommentAttachButton } from './CommentAttachButton';

function makeFile(name: string, size = 10, type = 'image/png') {
  return new File([new Uint8Array(size)], name, { type });
}

describe('CommentAttachButton', () => {
  it('lists both pending file names', () => {
    render(
      <CommentAttachButton
        pending={[makeFile('alpha.png'), makeFile('beta.pdf', 20, 'application/pdf')]}
        onPick={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText('alpha.png')).toBeInTheDocument();
    expect(screen.getByText('beta.pdf')).toBeInTheDocument();
  });

  it("calls onRemove(index) when a chip's ✕ is clicked", () => {
    const onRemove = vi.fn();
    render(
      <CommentAttachButton
        pending={[makeFile('alpha.png'), makeFile('beta.pdf')]}
        onPick={() => {}}
        onRemove={onRemove}
      />,
    );
    const removeButtons = screen.getAllByRole('button', { name: /remove/i });
    fireEvent.click(removeButtons[1]!);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('calls onPick with the selected files from the input', () => {
    const onPick = vi.fn();
    const { container } = render(
      <CommentAttachButton pending={[]} onPick={onPick} onRemove={() => {}} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const files = [makeFile('one.png'), makeFile('two.png')];
    fireEvent.change(input, { target: { files } });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(files);
  });

  it('does not fire onPick when the picker is dismissed with no files', () => {
    const onPick = vi.fn();
    const { container } = render(
      <CommentAttachButton pending={[]} onPick={onPick} onRemove={() => {}} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('disables the attach button when disabled', () => {
    render(<CommentAttachButton pending={[]} onPick={() => {}} onRemove={() => {}} disabled />);
    expect(screen.getByRole('button', { name: /attach files/i })).toBeDisabled();
  });
});
