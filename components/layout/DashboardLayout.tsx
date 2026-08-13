"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Clock, Lock, ShieldX, Truck } from "lucide-react";

import { useAuth } from "@/lib/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { permissionKeyForPath } from "@/lib/permissions";
import Sidebar from "./Sidebar";
import Header from "./Header";

interface DashboardLayoutProps {
  children: ReactNode;
}

/**
 * Every page in the app except `/login` renders through here, which
 * makes this the single place that enforces "you must be signed in to
 * use the app" (see lib/auth/AuthProvider.tsx) — rather than repeating
 * a guard in every `app/**\/page.tsx`. This is a client-side UX guard
 * only; the actual data protection is Supabase RLS on `lrs`/`pods`/
 * `lorry_expenses`/`app_users` (migration 017), which still applies
 * even if someone bypasses this redirect.
 *
 * This is also the single place that enforces the signup approval
 * gate (migration 018): a signed-in user whose `app_users.approval_
 * status` isn't "approved" sees a blocked screen instead of the
 * dashboard — no redirect, so there's no loop, and refreshing re-runs
 * this same check every time (via AuthProvider re-fetching `profile`
 * on load), so it can't be bypassed by reloading the page.
 *
 * Also enforces, in order: the account-lock switch (`is_locked`) and
 * then the per-module permission for the current route (via
 * `permissionKeyForPath()` + `hasPermission()`, migration 019). Same
 * caveat as above — this is the UX guard; `lrs`/`pods` are the only
 * tables where the database itself (`public.has_permission()`) also
 * enforces this if the guard is ever bypassed.
 */
export default function DashboardLayout({
  children,
}: DashboardLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    session,
    profile,
    loading,
    profileLoading,
    profileError,
    signOut,
    refreshProfile,
    hasPermission,
  } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!loading && !session) {
      router.replace("/login");
    }
  }, [loading, session, router]);

  // Route changes should always close the mobile drawer (e.g. after
  // tapping a nav link), on top of Sidebar already closing it itself.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  async function handleRetryProfile() {
    try {
      setRetrying(true);
      await refreshProfile();
    } finally {
      setRetrying(false);
    }
  }

  // State 1 — initial auth bootstrap, or waiting for redirect when
  // there is no session after init.
  if (loading || !session) {
    return (
      <div className="flex h-screen items-center justify-center bg-muted/30">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Truck className="h-8 w-8 animate-pulse" />
          <p className="text-sm font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  // Profile fetch in flight (e.g. right after sign-in) — still Loading,
  // but only while actively loading, never as a permanent stand-in for errors.
  if (profileLoading && !profile) {
    return (
      <div className="flex h-screen items-center justify-center bg-muted/30">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Truck className="h-8 w-8 animate-pulse" />
          <p className="text-sm font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  // State 3 — session exists but profile failed / missing after load finished.
  if (profileError || !profile) {
    return (
      <div className="flex h-screen items-center justify-center bg-muted/30 p-4">
        <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center shadow-sm">
          <ShieldX className="h-10 w-10 text-destructive" />

          <p className="text-sm font-medium text-foreground">
            {profileError || "Unable to load your account."}
          </p>

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              onClick={handleRetryProfile}
              disabled={retrying || profileLoading}
            >
              {retrying || profileLoading ? "Retrying..." : "Retry"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={signOut}
              disabled={retrying || profileLoading}
            >
              Sign out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (profile.approvalStatus !== "approved") {
    const isRejected = profile.approvalStatus === "rejected";

    return (
      <div className="flex h-screen items-center justify-center bg-muted/30 p-4">
        <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center shadow-sm">
          {isRejected ? (
            <ShieldX className="h-10 w-10 text-destructive" />
          ) : (
            <Clock className="h-10 w-10 text-warning" />
          )}

          <p className="text-sm font-medium text-foreground">
            {isRejected
              ? "Your account has not been approved. Please contact an administrator."
              : "Your account is awaiting administrator approval."}
          </p>

          <Button
            variant="outline"
            size="sm"
            onClick={signOut}
          >
            Sign Out
          </Button>
        </div>
      </div>
    );
  }

  if (profile.isLocked) {
    return (
      <div className="flex h-screen items-center justify-center bg-muted/30 p-4">
        <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center shadow-sm">
          <Lock className="h-10 w-10 text-destructive" />

          <p className="text-sm font-medium text-foreground">
            Your account has been locked. Please contact an administrator.
          </p>

          <Button
            variant="outline"
            size="sm"
            onClick={signOut}
          >
            Sign Out
          </Button>
        </div>
      </div>
    );
  }

  const requiredPermissionKey = permissionKeyForPath(pathname ?? "");

  if (requiredPermissionKey && !hasPermission(requiredPermissionKey, "view")) {
    return (
      <div className="flex h-screen overflow-hidden bg-muted/30">
        <Sidebar mobileOpen={mobileNavOpen} onMobileOpenChange={setMobileNavOpen} />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Header onMenuClick={() => setMobileNavOpen(true)} />

          <main className="flex flex-1 items-center justify-center overflow-y-auto p-4 sm:p-6 lg:p-8">
            <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center shadow-sm">
              <ShieldX className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm font-medium text-foreground">
                You do not have permission to access this section.
              </p>
              <p className="text-xs text-muted-foreground">
                Contact an administrator if you believe this is a mistake.
              </p>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-muted/30">
      <Sidebar mobileOpen={mobileNavOpen} onMobileOpenChange={setMobileNavOpen} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onMenuClick={() => setMobileNavOpen(true)} />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
