import { describe, it, expect } from 'vitest';
import { canToggleDisconnect, disconnectStatus } from './disconnectStatus';

function job(over: Record<string, any> = {}) {
  return {
    service_type: 'local_seo',
    stage: { id: 's-closed', code: 'closed', board: 'local_seo', display_names: {} },
    disconnected_at: null,
    ...over,
  } as Parameters<typeof disconnectStatus>[0];
}

describe('disconnectStatus', () => {
  it('local_seo job in Closed and not disconnected → needs_disconnect (red)', () => {
    expect(disconnectStatus(job())).toBe('needs_disconnect');
  });

  it('local_seo job with disconnected_at → disconnected (green), even outside Closed', () => {
    expect(disconnectStatus(job({ disconnected_at: '2026-08-28T10:00:00Z' }))).toBe('disconnected');
    expect(
      disconnectStatus(
        job({
          disconnected_at: '2026-08-28T10:00:00Z',
          stage: { id: 's-opt', code: 'optimize', board: 'local_seo', display_names: {} },
        }),
      ),
    ).toBe('disconnected');
  });

  it('local_seo job in another stage and not disconnected → null', () => {
    expect(
      disconnectStatus(
        job({ stage: { id: 's-done', code: 'done', board: 'local_seo', display_names: {} } }),
      ),
    ).toBeNull();
  });

  it('non-local_seo jobs never show the indicator (web_seo closed, ai_seo on the local board)', () => {
    expect(
      disconnectStatus(
        job({
          service_type: 'web_seo',
          stage: { id: 'w-closed', code: 'closed', board: 'web_seo', display_names: {} },
        }),
      ),
    ).toBeNull();
    expect(disconnectStatus(job({ service_type: 'ai_seo' }))).toBeNull();
    expect(
      disconnectStatus(job({ service_type: 'web_seo', disconnected_at: '2026-08-28T10:00:00Z' })),
    ).toBeNull();
  });

  it('missing stage join → null (never crashes)', () => {
    expect(disconnectStatus(job({ stage: null }))).toBeNull();
    expect(disconnectStatus(job({ stage: undefined }))).toBeNull();
  });
});

describe('canToggleDisconnect', () => {
  it('admins and local_seo members may toggle; accounting/others may not', () => {
    expect(canToggleDisconnect(true, [])).toBe(true);
    expect(canToggleDisconnect(false, ['local_seo'])).toBe(true);
    expect(canToggleDisconnect(false, ['accounting'])).toBe(false);
    expect(canToggleDisconnect(false, ['web_seo'])).toBe(false);
    expect(canToggleDisconnect(false, [])).toBe(false);
  });
});
