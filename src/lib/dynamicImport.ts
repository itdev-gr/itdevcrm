const RELOAD_KEY = 'app:chunk-reload-at';
const RELOAD_WINDOW_MS = 10_000;

type MiniStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const CHUNK_RE =
  /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch/i;

export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return CHUNK_RE.test(msg);
}

function defaultStorage(): MiniStorage {
  try {
    return window.sessionStorage;
  } catch {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    };
  }
}

/**
 * Reload the page to pick up a freshly-deployed build, at most once per
 * RELOAD_WINDOW_MS so a genuinely missing chunk can't loop. Returns whether a
 * reload was triggered. Deps are injectable for tests.
 */
export function reloadForNewVersion(
  now: number = Date.now(),
  storage: MiniStorage = defaultStorage(),
  reload: () => void = () => window.location.reload(),
): boolean {
  const raw = storage.getItem(RELOAD_KEY);
  if (raw && now - Number(raw) < RELOAD_WINDOW_MS) return false;
  storage.setItem(RELOAD_KEY, String(now));
  reload();
  return true;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wrap a dynamic import() factory: retry once for transient failures, then —
 * if it still fails with a chunk-load error after a deploy — reload to fetch
 * the new app. While reloading, returns a never-settling promise so no error
 * UI flashes first.
 */
export async function importWithRetry<T>(
  factory: () => Promise<T>,
  opts: { retryDelayMs?: number } = {},
): Promise<T> {
  try {
    return await factory();
  } catch {
    try {
      await delay(opts.retryDelayMs ?? 500);
      return await factory();
    } catch (err2) {
      if (isChunkLoadError(err2) && reloadForNewVersion()) {
        return new Promise<T>(() => {});
      }
      throw err2;
    }
  }
}
