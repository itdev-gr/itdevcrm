import { isChunkLoadError, reloadForNewVersion, importWithRetry } from './dynamicImport';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('isChunkLoadError', () => {
  it('matches dynamic import failures', () => {
    expect(
      isChunkLoadError(new Error('Failed to fetch dynamically imported module: https://x/a.js')),
    ).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
  });
  it('ignores unrelated errors', () => {
    expect(isChunkLoadError(new Error('boom'))).toBe(false);
  });
});

describe('reloadForNewVersion', () => {
  it('reloads once, then suppresses within the window', () => {
    const storage = fakeStorage();
    let reloads = 0;
    const reload = () => {
      reloads += 1;
    };
    expect(reloadForNewVersion(1000, storage, reload)).toBe(true);
    expect(reloadForNewVersion(5000, storage, reload)).toBe(false); // within 10s
    expect(reloadForNewVersion(20000, storage, reload)).toBe(true); // window passed
    expect(reloads).toBe(2);
  });
});

describe('importWithRetry', () => {
  it('returns the module on first success', async () => {
    const mod = { default: 1 };
    await expect(importWithRetry(() => Promise.resolve(mod), { retryDelayMs: 0 })).resolves.toBe(mod);
  });
  it('retries once and succeeds', async () => {
    let n = 0;
    const factory = () => (n++ === 0 ? Promise.reject(new Error('net')) : Promise.resolve('ok'));
    await expect(importWithRetry(factory, { retryDelayMs: 0 })).resolves.toBe('ok');
  });
  it('rethrows a non-chunk error after the retry', async () => {
    const factory = () => Promise.reject(new Error('boom'));
    await expect(importWithRetry(factory, { retryDelayMs: 0 })).rejects.toThrow('boom');
  });
});
