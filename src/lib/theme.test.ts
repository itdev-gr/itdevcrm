import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_STORAGE_KEY,
  isThemeMode,
  resolveTheme,
  getStoredMode,
} from './theme';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('isThemeMode', () => {
  it('accepts the three valid modes', () => {
    expect(isThemeMode('light')).toBe(true);
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('system')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isThemeMode('blue')).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('returns the explicit mode unchanged for light/dark', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the system preference when mode is system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('getStoredMode', () => {
  it('defaults to system when nothing is stored', () => {
    expect(getStoredMode()).toBe('system');
  });

  it('returns a stored valid mode', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(getStoredMode()).toBe('dark');
  });

  it('falls back to system for a corrupt stored value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'banana');
    expect(getStoredMode()).toBe('system');
  });
});
