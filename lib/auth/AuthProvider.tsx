"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";
import { getMyProfile, type AppUserProfile } from "@/components/services/appUser.service";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: AppUserProfile | null;
  /** True once the initial session/profile lookup has finished — used
   * by DashboardLayout to avoid redirecting to /login before the
   * existing session (if any) has had a chance to load. */
  loading: boolean;
  isAdmin: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Wraps the whole app (see app/layout.tsx) so every page — including
 * `/login`, which sits outside `DashboardLayout` — can read the
 * current Supabase Auth session and the matching `app_users` profile
 * (id/email/displayName/role) via `useAuth()`.
 *
 * This is the single source of "who is logged in" for the staff
 * ownership model — `DashboardLayout` uses it to gate every other
 * route, and the LR/POD/Lorry Expenses screens use `isAdmin` to decide
 * whether to show admin-only actions (Reassign, Staff page). Real
 * enforcement still lives in the database via RLS (migration 017);
 * this context is the UI-side reflection of that, not a replacement
 * for it.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AppUserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    try {
      const data = await getMyProfile(userId);
      setProfile(data);
    } catch (error) {
      console.error(error);
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;

      setSession(data.session);

      if (data.session?.user) {
        loadProfile(data.session.user.id).finally(() => {
          if (active) setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);

      if (nextSession?.user) {
        loadProfile(nextSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  async function refreshProfile() {
    if (session?.user) await loadProfile(session.user.id);
  }

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    isAdmin: profile?.role === "admin",
    signOut,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be used within <AuthProvider>.");
  return ctx;
}
