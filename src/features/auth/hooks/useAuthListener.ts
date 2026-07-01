import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { fetchProfile, fetchUserGroupCodes } from '@/lib/profile';
import { Sentry } from '@/lib/sentry';
import type { Session, User } from '@supabase/supabase-js';

// Supabase fires several auth events for one signed-in user (INITIAL_SESSION,
// SIGNED_IN, TOKEN_REFRESHED, plus our own getSession bootstrap). The profile
// and group rows only change on a real user switch, so remember who we last
// hydrated and skip the duplicate round-trips.
let lastHydratedUserId: string | null = null;

/** Test-only: clear the module-level hydration memo between test cases. */
export function __resetAuthHydrationForTests(): void {
  lastHydratedUserId = null;
}

async function hydrate(session: Session | null, user: User | null) {
  const setSession = useAuthStore.getState().setSession;
  const setProfile = useAuthStore.getState().setProfile;

  setSession(session, user);

  if (user && user.id === lastHydratedUserId) return;

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
      if (!profile.is_active) {
        // Admin deactivated this account: sign out immediately, so the app
        // bounces to /login even if the session's access token is still
        // technically valid. Login attempts are also blocked at the auth
        // layer by set_user_active setting a permanent ban.
        await supabase.auth.signOut();
        return;
      }
      setProfile({ isAdmin: profile.is_admin, groupCodes });
      // Only mark hydrated on success so a later auth event retries after a
      // transient fetch failure.
      lastHydratedUserId = user.id;
    } catch {
      // Network / RLS failure: keep session, treat as no admin / no groups.
      setProfile({ isAdmin: false, groupCodes: [] });
    }
  } else {
    lastHydratedUserId = null;
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
