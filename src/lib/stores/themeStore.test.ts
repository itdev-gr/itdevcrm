import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY } from '@/lib/theme';
import { useThemeStore } from './themeStore';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  useThemeStore.setState({ mode: 'system' });
});

afterEach(() => {
  document.documentElement.classList.remove('dark');
});

describe('themeStore.setMode', () => {
  it('adds the dark class and persists when set to dark', () => {
    useThemeStore.getState().setMode('dark');
    expect(useThemeStore.getState().mode).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('removes the dark class when set to light', () => {
    document.documentElement.classList.add('dark');
    useThemeStore.getState().setMode('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('resolves system to light when the OS does not prefer dark (matchMedia mock returns false)', () => {
    document.documentElement.classList.add('dark');
    useThemeStore.getState().setMode('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });
});
