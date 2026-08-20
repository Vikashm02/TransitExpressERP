"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { format, parseISO } from "date-fns";

import { useAuth } from "@/lib/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { AUTH_PASSWORD_MIN_LENGTH } from "@/lib/auth/passwordPolicy";
import {
  getOverviewSnapshot,
  type OverviewSnapshot,
} from "@/components/services/overview.service";
import {
  LANDING_PAGE_OPTIONS,
  readDefaultLandingPage,
  writeDefaultLandingPage,
  type LandingPageValue,
} from "@/lib/profilePreferences";
import { defaultOverviewPeriod } from "@/components/overview/OverviewPeriodFilter";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";

function formatMaybeIso(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const d = value.includes("T") ? parseISO(value) : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return format(d, "dd MMM yyyy, HH:mm");
  } catch {
    return null;
  }
}

export default function ProfilePageClient() {
  const { profile, user, isAdmin } = useAuth();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [themeReady, setThemeReady] = useState(false);

  const [landing, setLanding] = useState<LandingPageValue>("/");
  const [currentPasswordNote] = useState(true);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [sessionsBusy, setSessionsBusy] = useState(false);

  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);

  useEffect(() => {
    setThemeReady(true);
    setLanding(readDefaultLandingPage());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const period = defaultOverviewPeriod("month");
    setActivityLoading(true);
    getOverviewSnapshot(period.fromDate, period.toDate)
      .then((data) => {
        if (!cancelled) setSnapshot(data);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setSnapshot(null);
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const initials = useMemo(() => {
    const name = profile?.displayName?.trim() || "?";
    return name.charAt(0).toUpperCase();
  }, [profile?.displayName]);

  const lastLogin = formatMaybeIso(
    (user as { last_sign_in_at?: string | null } | null)?.last_sign_in_at ??
      null,
  );

  const email = profile?.email || user?.email || "—";

  async function handleChangePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError(null);

    if (newPassword.length < AUTH_PASSWORD_MIN_LENGTH) {
      setPasswordError(
        `Password must be at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`,
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    try {
      setPasswordBusy(true);
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated successfully.");
    } catch (error) {
      console.error(error);
      setPasswordError(
        error instanceof Error ? error.message : "Unable to update password.",
      );
    } finally {
      setPasswordBusy(false);
    }
  }

  async function handleSignOutOthers() {
    try {
      setSessionsBusy(true);
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw error;
      toast.success("Signed out of other sessions.");
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to sign out other sessions.",
      );
    } finally {
      setSessionsBusy(false);
    }
  }

  function handleLandingChange(value: string) {
    const next = value as LandingPageValue;
    setLanding(next);
    writeDefaultLandingPage(next);
    toast.success("Default landing page saved on this device.");
  }

  function handleThemeChange(value: string) {
    if (value === "light" || value === "dark" || value === "system") {
      setTheme(value);
      toast.success("Theme preference saved on this device.");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Profile
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account details, security, and personal preferences for this
          device.
        </p>
      </div>

      {/* Personal information — display only */}
      <Card>
        <CardHeader>
          <CardTitle>Personal information</CardTitle>
          <CardDescription>
            Name changes are managed by an administrator from Staff management.
            Email cannot be changed here.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-highlight text-xl font-semibold text-highlight-foreground">
            {initials}
          </div>
          <div className="grid flex-1 gap-4 sm:grid-cols-2">
            <FormField label="Full name">
              <Input
                readOnly
                value={profile?.displayName || "—"}
                className="bg-muted/40"
              />
            </FormField>
            <FormField label="Email / Login ID">
              <Input readOnly value={email} className="bg-muted/40" />
            </FormField>
            <FormField label="Role">
              <Input
                readOnly
                value={isAdmin ? "Administrator" : "Staff"}
                className="bg-muted/40"
              />
            </FormField>
            {lastLogin ? (
              <FormField label="Last login">
                <Input readOnly value={lastLogin} className="bg-muted/40" />
              </FormField>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>
            Change your password or sign out of sessions on other devices.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form
            onSubmit={handleChangePassword}
            className="grid max-w-lg gap-4 sm:grid-cols-2"
          >
            {currentPasswordNote ? (
              <p className="sm:col-span-2 text-xs text-muted-foreground">
                Enter a new password for this account. You will stay signed in
                on this device.
              </p>
            ) : null}
            <FormField label="New password" htmlFor="profile-new-password">
              <Input
                id="profile-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={`At least ${AUTH_PASSWORD_MIN_LENGTH} characters`}
              />
            </FormField>
            <FormField
              label="Confirm new password"
              htmlFor="profile-confirm-password"
            >
              <Input
                id="profile-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </FormField>
            {passwordError ? (
              <p className="sm:col-span-2 text-sm text-destructive">
                {passwordError}
              </p>
            ) : null}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={passwordBusy}>
                {passwordBusy ? "Updating…" : "Change password"}
              </Button>
            </div>
          </form>

          <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Other sessions</p>
              <p className="text-xs text-muted-foreground">
                Sign out everywhere else while keeping this browser signed in.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={sessionsBusy}
              onClick={() => void handleSignOutOthers()}
            >
              {sessionsBusy ? "Working…" : "Sign out of other sessions"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preferences — client only */}
      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
          <CardDescription>
            Stored on this device only. Not synced to the server.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid max-w-lg gap-4 sm:grid-cols-2">
          <FormSelect
            label="Theme"
            value={themeReady ? theme || "system" : "system"}
            onValueChange={handleThemeChange}
            options={[
              {
                value: "system",
                label:
                  themeReady && resolvedTheme
                    ? `System (${resolvedTheme})`
                    : "System",
              },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
          <FormSelect
            label="Default page after login"
            value={landing}
            onValueChange={handleLandingChange}
            options={LANDING_PAGE_OPTIONS.map((opt) => ({
              value: opt.value,
              label:
                opt.value === "/"
                  ? "Dashboard"
                  : opt.value === "/lr"
                    ? "LR Entry"
                    : opt.value === "/pod"
                      ? "POD Entry"
                      : "Profile",
            }))}
          />
        </CardContent>
      </Card>

      {/* My Work */}
      <Card>
        <CardHeader>
          <CardTitle>My work</CardTitle>
          <CardDescription>
            Open items for your account (from Overview).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activityLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">LR drafts</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {snapshot?.open.lrDraftsCount ?? "—"}
                </p>
                <Link
                  href="/lr"
                  className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
                >
                  Open LR Entry
                </Link>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Pending PODs</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {snapshot?.open.pendingPodCount ?? "—"}
                </p>
                <Link
                  href="/pod"
                  className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
                >
                  Open POD Entry
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* My Activity */}
      <Card>
        <CardHeader>
          <CardTitle>My activity</CardTitle>
          <CardDescription>
            Recent work this month (from Overview).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {activityLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label="LRs created"
                  value={snapshot?.period.lrsCreated}
                />
                <Metric
                  label="LRs updated"
                  value={snapshot?.period.lrsUpdated}
                />
                <Metric
                  label="PODs created"
                  value={snapshot?.period.podsCreated}
                />
                <Metric
                  label="DCs created"
                  value={snapshot?.period.dcsCreated}
                />
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">Recent items</p>
                {!snapshot?.recent?.length ? (
                  <p className="text-sm text-muted-foreground">
                    No recent activity in this period.
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {snapshot.recent.slice(0, 8).map((item) => (
                      <li
                        key={`${item.module}-${item.id}-${item.at}`}
                        className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {item.reference || item.id}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {String(item.module).toUpperCase()} · {item.action}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {formatMaybeIso(item.at) ?? "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Link
                href="/"
                className="inline-block text-sm font-medium text-primary hover:underline"
              >
                Open full Overview
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">
        {value === null || value === undefined ? "—" : value}
      </p>
    </div>
  );
}
