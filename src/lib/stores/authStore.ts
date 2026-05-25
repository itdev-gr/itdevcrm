import { create } from 'zustand';
import type { User, Session } from '@supabase/supabase-js';

export type ViewAsUser = {
  userId: string;
  email: string;
  fullName: string;
  isAdmin: boolean;
  groupCodes: string[];
};

export type AuthState = {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  groupCodes: string[];
  viewAsUser: ViewAsUser | null;
  isLoading: boolean;
  setSession: (session: Session | null, user: User | null) => void;
  setProfile: (params: { isAdmin: boolean; groupCodes: string[] }) => void;
  setViewAsUser: (user: ViewAsUser | null) => void;
  clearViewAsUser: () => void;
  reset: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  isAdmin: false,
  groupCodes: [],
  viewAsUser: null,
  isLoading: true,
  setSession: (session, user) =>
    set((state) => ({
      session,
      user,
      isLoading: false,
      ...(state.user?.id !== user?.id ? { viewAsUser: null } : {}),
    })),
  setProfile: ({ isAdmin, groupCodes }) => set({ isAdmin, groupCodes }),
  setViewAsUser: (user) => set({ viewAsUser: user }),
  clearViewAsUser: () => set({ viewAsUser: null }),
  reset: () =>
    set({
      user: null,
      session: null,
      isAdmin: false,
      groupCodes: [],
      viewAsUser: null,
      isLoading: false,
    }),
}));
