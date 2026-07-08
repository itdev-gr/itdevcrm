import { describe, it, expect, vi, afterEach } from 'vitest';
import { openPdfInNewTab } from './openPdfInNewTab';

type FakeTab = { document: { write: ReturnType<typeof vi.fn> }; location: { href: string }; close: ReturnType<typeof vi.fn> };

function fakeTab(): FakeTab {
  return { document: { write: vi.fn() }, location: { href: '' }, close: vi.fn() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openPdfInNewTab', () => {
  it('opens a tab synchronously and points it at the signed URL', async () => {
    const tab = fakeTab();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    await openPdfInNewTab(() => Promise.resolve('https://signed.example/x.pdf'));
    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(tab.location.href).toBe('https://signed.example/x.pdf');
    expect(tab.close).not.toHaveBeenCalled();
  });

  it('closes the tab and alerts on failure', async () => {
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    await openPdfInNewTab(() => Promise.reject(new Error('boom')));
    expect(tab.close).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('boom');
  });
});
