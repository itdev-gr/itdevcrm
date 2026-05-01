import { create } from 'zustand';
import type { User, Session } from '@supabase/supabase-js';

export type AuthState = {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  groupCodes: string[];
  isLoading: boolean;
  setSession: (session: Session | null, user: User | null) => void;
  setProfile: (params: { isAdmin: boolean; groupCodes: string[] }) => void;
  reset: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  isAdmin: false,
  groupCodes: [],
  isLoading: true,
  setSession: (session, user) => set({ session, user, isLoading: false }),
  setProfile: ({ isAdmin, groupCodes }) => set({ isAdmin, groupCodes }),
  reset: () =>
    set({
      user: null,
      session: null,
      isAdmin: false,
      groupCodes: [],
      isLoading: false,
    }),
}));
