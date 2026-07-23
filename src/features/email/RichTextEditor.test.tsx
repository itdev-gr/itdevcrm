import { render, screen, fireEvent } from '@testing-library/react';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { RichTextEditor } from './RichTextEditor';

const execCommand = vi.fn();

beforeEach(() => {
  execCommand.mockReset();
  // execCommand is legacy and unimplemented in jsdom — mock it.
  document.execCommand = execCommand as unknown as typeof document.execCommand;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RichTextEditor', () => {
  // NB: assertions use vitest-native matchers (getByRole throws when absent, so it
  // already asserts existence). jest-dom's toBeInTheDocument is not extended in an
  // isolated single-file `vitest run` in this repo, and this task runs file-scoped.
  it('renders the formatting toolbar buttons', () => {
    render(<RichTextEditor value="" onChange={() => {}} ariaLabel="Message body" />);
    expect(screen.getByRole('button', { name: /Bold|Έντονα/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Italic|Πλάγια/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Underline|Υπογράμμιση/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Text colour|Χρώμα κειμένου/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Bullet list|Λίστα με κουκκίδες/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Numbered list|Αριθμημένη λίστα/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^(Link|Σύνδεσμος)$/ })).toBeTruthy();
  });

  it('exposes the editable region with the given aria-label', () => {
    render(<RichTextEditor value="" onChange={() => {}} ariaLabel="Message body" />);
    expect(screen.getByRole('textbox', { name: 'Message body' })).toBeTruthy();
  });

  it('runs execCommand("bold") when the Bold button is clicked', () => {
    render(<RichTextEditor value="" onChange={() => {}} ariaLabel="Message body" />);
    fireEvent.click(screen.getByRole('button', { name: /Bold|Έντονα/ }));
    expect(execCommand).toHaveBeenCalledWith('bold', false, undefined);
  });

  it('runs execCommand("insertUnorderedList") for the bullet-list button', () => {
    render(<RichTextEditor value="" onChange={() => {}} ariaLabel="Message body" />);
    fireEvent.click(screen.getByRole('button', { name: /Bullet list|Λίστα με κουκκίδες/ }));
    expect(execCommand).toHaveBeenCalledWith('insertUnorderedList', false, undefined);
  });

  it('emits the innerHTML through onChange when the user types', () => {
    const onChange = vi.fn();
    render(<RichTextEditor value="" onChange={onChange} ariaLabel="Message body" />);
    const region = screen.getByRole('textbox', { name: 'Message body' });
    region.innerHTML = '<b>hi</b>';
    fireEvent.input(region);
    expect(onChange).toHaveBeenCalledWith('<b>hi</b>');
  });

  it('does not run execCommand while disabled', () => {
    render(<RichTextEditor value="" onChange={() => {}} ariaLabel="Message body" disabled />);
    fireEvent.click(screen.getByRole('button', { name: /Bold|Έντονα/ }));
    expect(execCommand).not.toHaveBeenCalled();
  });
});
