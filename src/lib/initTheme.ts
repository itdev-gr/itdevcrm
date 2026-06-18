import {
  applyResolvedTheme,
  getStoredMode,
  resolveTheme,
  systemPrefersDark,
} from '@/lib/theme';
import { useThemeStore } from '@/lib/stores/themeStore';

/**
 * Apply the saved theme immediately and keep `system` mode in sync with the OS.
 * Call once at startup. The inline script in index.html handles the pre-paint
 * application to avoid a flash; this also wires the live media-query listener.
 */
export function initTheme(): void {
  applyResolvedTheme(resolveTheme(getStoredMode(), systemPrefersDark()));

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return;
  }
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', (event) => {
    if (useThemeStore.getState().mode === 'system') {
      applyResolvedTheme(event.matches ? 'dark' : 'light');
    }
  });
}
