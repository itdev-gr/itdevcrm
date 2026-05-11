import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { fetchProfile, fetchUserGroupCodes } from '@/lib/profile';
import { Sentry } from '@/lib/sentry';
import type { Session, User } from '@supabase/supabase-js';

async function hydrate(session: Session | null, user: User | null) {
  const setSession = useAuthStore.getState().setSession;
  const setProfile = useAuthStore.getState().setProfile;

  setSession(session, user);

  if (user) {
    Sentry.setUser({ id: user.id, ...(user.email ? { email: user.email } : {}) });
    try {
      const [profile, groupCodes] = await Promise.all([
        fetchProfile(user.id),
        fetchUserGroupCodes(user.id),
      ]);
      if (!profile) {
        // Orphan session: auth row exists for this user but the profile row
        // doesn't (e.g. they were deleted out-of-band). Drop the session so
        // the app bounces back to /login cleanly instead of running with a
        // half-hydrated state and 406s in the console.
        await supabase.auth.signOut();
        return;
      }
      setProfile({ isAdmin: profile.is_admin, groupCodes });
    } catch {
      // Network / RLS failure: keep session, treat as no admin / no groups.
      setProfile({ isAdmin: false, groupCodes: [] });
    }
  } else {
    Sentry.setUser(null);
    setProfile({ isAdmin: false, groupCodes: [] });
  }
}

export function useAuthListener(): void {
  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      void hydrate(data.session, data.session?.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void hydrate(session, session?.user ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
}
