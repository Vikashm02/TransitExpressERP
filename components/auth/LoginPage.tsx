"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import FormField from "@/components/ui/FormField";

type Tab = "sign-in" | "sign-up";

/**
 * The app's only unauthenticated screen — every other route is gated
 * behind a session by `DashboardLayout` (see components/layout/
 * DashboardLayout.tsx). Uses Supabase Auth directly (email/password);
 * no extra `@supabase/*` auth package is required since the app is
 * entirely client-rendered and `supabase-js` already manages the
 * session for every subsequent `.from(...)` call once signed in.
 *
 * Sign-up intentionally has NO "role" selector, and never sends a role
 * to the server — every new account always starts as `staff` with
 * `approvalStatus: "pending"`, enforced server-side by migration
 * 017/018's `handle_new_auth_user()` trigger (hard-coded, never
 * derived from anything the client sends). The very first Admin is
 * created via a one-time manual SQL step documented in migration
 * 017, not by signing up; from then on, an existing Admin
 * promotes/demotes roles and approves/rejects pending signups from
 * the Staff page. A pending/rejected account can still sign in (the
 * Supabase Auth credentials are valid) but is blocked from the rest
 * of the app by `DashboardLayout` until an Admin approves it.
 */
export default function LoginPage() {
  const router = useRouter();
  const { session } = useAuth();

  const [tab, setTab] = useState<Tab>("sign-in");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (session) {
    router.replace("/");
    return null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!email.trim() || !password) {
      setFormError("Email and password are required.");
      return;
    }

    try {
      setSubmitting(true);

      if (tab === "sign-up") {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: displayName.trim() || email.trim().split("@")[0] },
          },
        });

        if (error) throw error;

        toast.success("Account created. Your account is awaiting administrator approval.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) throw error;

        toast.success("Signed in successfully.");
      }

      router.replace("/");
    } catch (error) {
      console.error(error);
      setFormError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 sm:p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,oklch(0.345_0.09_252_/_0.18),transparent_55%),radial-gradient(ellipse_at_bottom_right,oklch(0.72_0.13_70_/_0.16),transparent_50%)]" />
      <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-[42%] bg-primary lg:block" />
      <div className="pointer-events-none absolute bottom-8 left-8 hidden max-w-sm text-primary-foreground lg:block">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-highlight">
          Transjit Express
        </p>
        <p className="mt-2 font-heading text-3xl font-semibold tracking-tight">
          Logistics control, built for the yard.
        </p>
        <p className="mt-2 text-sm text-primary-foreground/75">
          LR · POD · Delivery · Financials — one operational console for the team on the move.
        </p>
      </div>

      <Card className="relative z-10 w-full max-w-md border-border/70 shadow-xl shadow-primary/10">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-primary/10 ring-1 ring-primary/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/icon-192.png"
              alt="Transjit Express"
              className="h-12 w-12 object-contain"
            />
          </div>
          <CardTitle className="text-xl">Transjit Express TMS</CardTitle>
          <CardDescription>
            {tab === "sign-in" ? "Sign in to your staff account." : "Create your staff account."}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            <Button
              type="button"
              variant={tab === "sign-in" ? "default" : "ghost"}
              size="sm"
              onClick={() => {
                setTab("sign-in");
                setFormError(null);
              }}
            >
              Sign In
            </Button>
            <Button
              type="button"
              variant={tab === "sign-up" ? "default" : "ghost"}
              size="sm"
              onClick={() => {
                setTab("sign-up");
                setFormError(null);
              }}
            >
              Sign Up
            </Button>
          </div>

          <form
            className="space-y-4"
            onSubmit={handleSubmit}
          >
            {tab === "sign-up" && (
              <FormField
                label="Your Name"
                htmlFor="login-display-name"
              >
                <Input
                  id="login-display-name"
                  placeholder="e.g. Roshan"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </FormField>
            )}

            <FormField
              label="Email"
              htmlFor="login-email"
              required
            >
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormField>

            <FormField
              label="Password"
              htmlFor="login-password"
              required
            >
              <Input
                id="login-password"
                type="password"
                autoComplete={tab === "sign-in" ? "current-password" : "new-password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormField>

            {formError && (
              <p className="text-sm font-medium text-destructive">{formError}</p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={submitting}
            >
              {submitting
                ? "Please wait..."
                : tab === "sign-in"
                ? "Sign In"
                : "Create Account"}
            </Button>
          </form>

          {tab === "sign-up" && (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              New accounts always start as Staff and require Administrator approval before you can sign in and
              use the app.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
