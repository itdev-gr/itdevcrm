import { create } from 'zustand';
import {
  applyResolvedTheme,
  getStoredMode,
  resolveTheme,
  storeMode,
  systemPrefersDark,
  type ThemeMode,
} from '@/lib/theme';

export type ThemeState = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

export const useThemeStore = create<ThemeState>((set) => ({
  mode: getStoredMode(),
  setMode: (mode) => {
    storeMode(mode);
    applyResolvedTheme(resolveTheme(mode, systemPrefersDark()));
    set({ mode });
  },
}));
