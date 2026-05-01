import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { fetchProfile, fetchUserGroupCodes } from '@/lib/profile';
import type { Session, User } from '@supabase/supabase-js';

async function hydrate(session: Session | null, user: User | null) {
  const setSession = useAuthStore.getState().setSession;
  const setProfile = useAuthStore.getState().setProfile;

  setSession(session, user);

  if (user) {
    try {
      const [profile, groupCodes] = await Promise.all([
        fetchProfile(user.id),
        fetchUserGroupCodes(user.id),
      ]);
      setProfile({ isAdmin: profile.is_admin, groupCodes });
    } catch {
      // Profile fetch failure: keep session, treat as no admin / no groups.
      setProfile({ isAdmin: false, groupCodes: [] });
    }
  } else {
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
