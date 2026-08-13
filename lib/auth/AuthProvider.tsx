"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";
import { getMyProfile, type AppUserProfile } from "@/components/services/appUser.service";
import { getMyPermissions, type PermissionMap } from "@/components/services/permission.service";
import { meetsLevel, type PermissionKey, type PermissionLevel } from "@/lib/permissions";

const SESSION_TIMEOUT_MS = 15_000;
const PROFILE_TIMEOUT_MS = 15_000;
const PROFILE_MAX_ATTEMPTS = 2;

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: AppUserProfile | null;
  /**
   * True while the initial `getSession()` bootstrap is unfinished
   * (including the first profile load when a session already exists).
   * Used by DashboardLayout to avoid redirecting to /login too early.
   */
  loading: boolean;
  /** True while a profile/permissions fetch is in flight for the current user. */
  profileLoading: boolean;
  /**
   * User-facing profile failure message when a session exists but the
   * `app_users` profile could not be loaded. Null when OK / not applicable.
   */
  profileError: string | null;
  isAdmin: boolean;
  /**
   * Staff / Sub-User Access Control (migration 019). Admins always
   * pass. A staff account with `profile.fullAccess` always passes.
   * Otherwise this checks the loaded `app_user_permissions` rows.
   * This is a UX convenience for nav/route gating only — real
   * enforcement for `lrs`/`pods` lives in `public.has_permission()`
   * at the database layer (see that migration).
   */
  hasPermission: (key: PermissionKey, level: PermissionLevel) => boolean;
  signOut: () => Promise<void>;
  /** Re-fetch profile/permissions for the current session user. */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

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
  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  /** Monotonic id so only the latest loadProfile result may commit state. */
  const profileRequestIdRef = useRef(0);
  const profileRef = useRef<AppUserProfile | null>(null);
  const profileErrorRef = useRef<string | null>(null);
  const loadingRef = useRef(true);
  const profileLoadingRef = useRef(false);

  profileRef.current = profile;
  profileErrorRef.current = profileError;
  loadingRef.current = loading;
  profileLoadingRef.current = profileLoading;

  const clearProfileState = useCallback(() => {
    setProfile(null);
    setPermissions({});
    setProfileError(null);
    setProfileLoading(false);
  }, []);

  const loadProfile = useCallback(async (userId: string) => {
    const requestId = ++profileRequestIdRef.current;
    setProfileLoading(true);
    setProfileError(null);

    let lastError: unknown;

    try {
      for (let attempt = 1; attempt <= PROFILE_MAX_ATTEMPTS; attempt++) {
        if (requestId !== profileRequestIdRef.current) return;

        try {
          const [data, perms] = await withTimeout(
            Promise.all([
              getMyProfile(userId),
              getMyPermissions(userId).catch((error) => {
                console.error(error);
                return {} as PermissionMap;
              }),
            ]),
            PROFILE_TIMEOUT_MS,
            "Profile load"
          );

          if (requestId !== profileRequestIdRef.current) return;

          if (!data) {
            console.error("getMyProfile returned null for user", userId);
            setProfile(null);
            setPermissions({});
            setProfileError("Unable to load your account.");
            return;
          }

          setProfile(data);
          setPermissions(perms);
          setProfileError(null);
          return;
        } catch (error) {
          lastError = error;
          console.error(error);
          if (
            attempt < PROFILE_MAX_ATTEMPTS &&
            requestId === profileRequestIdRef.current
          ) {
            await new Promise((resolve) => window.setTimeout(resolve, 400));
          }
        }
      }

      if (requestId !== profileRequestIdRef.current) return;

      console.error("Profile load failed after retries", lastError);
      setProfile(null);
      setPermissions({});
      setProfileError("Unable to load your account.");
    } finally {
      if (requestId === profileRequestIdRef.current) {
        setProfileLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const { data, error } = await withTimeout(
          supabase.auth.getSession(),
          SESSION_TIMEOUT_MS,
          "getSession"
        );
        if (!active) return;

        if (error) {
          console.error(error);
          setSession(null);
          clearProfileState();
          return;
        }

        setSession(data.session);

        if (data.session?.user) {
          await loadProfile(data.session.user.id);
        } else {
          clearProfileState();
        }
      } catch (error) {
        console.error(error);
        if (!active) return;
        setSession(null);
        clearProfileState();
      } finally {
        if (active) setLoading(false);
      }
    }

    void bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;

      setSession(nextSession);

      if (!nextSession?.user) {
        profileRequestIdRef.current += 1;
        clearProfileState();
        return;
      }

      const userId = nextSession.user.id;

      // Token refresh updates the session JWT only — do not re-fetch
      // profile (avoids races / overwriting a good profile).
      if (
        event === "TOKEN_REFRESHED" &&
        profileRef.current?.id === userId &&
        !profileErrorRef.current
      ) {
        return;
      }

      // INITIAL_SESSION duplicates bootstrap's getSession() path.
      // Only recover if bootstrap already finished without a profile.
      if (event === "INITIAL_SESSION") {
        if (
          !loadingRef.current &&
          !profileRef.current &&
          !profileErrorRef.current &&
          !profileLoadingRef.current
        ) {
          void loadProfile(userId);
        }
        return;
      }

      void loadProfile(userId);
    });

    return () => {
      active = false;
      profileRequestIdRef.current += 1;
      subscription.unsubscribe();
    };
  }, [clearProfileState, loadProfile]);

  async function signOut() {
    profileRequestIdRef.current += 1;
    clearProfileState();
    await supabase.auth.signOut();
  }

  async function refreshProfile() {
    const userId = session?.user?.id;
    if (!userId) return;
    await loadProfile(userId);
  }

  const isAdmin = profile?.role === "admin";

  function hasPermission(key: PermissionKey, level: PermissionLevel): boolean {
    if (isAdmin) return true;
    if (!profile || profile.isLocked || profile.approvalStatus !== "approved") return false;
    if (profile.fullAccess) return true;
    return meetsLevel(permissions[key] ?? "none", level);
  }

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    profileLoading,
    profileError,
    isAdmin,
    hasPermission,
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
