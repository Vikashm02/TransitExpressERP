"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase";
import {
  getPasswordRequirementHint,
  validateNewPassword,
} from "@/lib/auth/passwordPolicy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import FormField from "@/components/ui/FormField";

type Step = "request" | "verify" | "password" | "done";

const RESEND_COOLDOWN_SECONDS = 60;
/** Non-sensitive UI flag only — never stores passwords, OTPs, or tokens. */
const RECOVERY_UI_FLAG = "erp_password_recovery";

const GENERIC_CODE_SENT =
  "If an account exists for this email address, a verification code has been sent.";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function markRecoveryUiActive() {
  try {
    sessionStorage.setItem(RECOVERY_UI_FLAG, "1");
  } catch {
    // Ignore storage failures (private mode, etc.).
  }
}

function clearRecoveryUiFlag() {
  try {
    sessionStorage.removeItem(RECOVERY_UI_FLAG);
  } catch {
    // Ignore storage failures.
  }
}

function isRecoveryUiActive(): boolean {
  try {
    return sessionStorage.getItem(RECOVERY_UI_FLAG) === "1";
  } catch {
    return false;
  }
}

function friendlyAuthError(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) return fallback;

  const message = error.message.toLowerCase();

  if (
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("email rate limit")
  ) {
    return "Too many requests. Please wait a moment and try again.";
  }

  if (
    message.includes("otp") ||
    message.includes("token") ||
    message.includes("expired") ||
    message.includes("invalid")
  ) {
    if (message.includes("password")) {
      return "That password does not meet the requirements. Please choose a stronger password.";
    }
    return "That verification code is invalid or has expired. Request a new code and try again.";
  }

  if (message.includes("same password") || message.includes("different from the old")) {
    return "Choose a password that is different from your current password.";
  }

  if (message.includes("network") || message.includes("fetch")) {
    return "Network error. Check your connection and try again.";
  }

  if (message.includes("session") || message.includes("auth session missing")) {
    return "Your reset session has expired. Request a new verification code.";
  }

  // Never surface raw Auth/database internals.
  return fallback;
}

function shouldTreatAsSent(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  // Avoid account enumeration — treat "not found"/similar as success.
  return (
    message.includes("user not found") ||
    message.includes("unable to find") ||
    message.includes("email not found") ||
    message.includes("signup_disabled")
  );
}

function isRateLimited(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("email rate limit")
  );
}

/**
 * Forgot / reset password via Supabase Auth recovery OTP.
 * Does not store OTPs or reset codes in the app database.
 */
export default function ForgotPasswordPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const startCooldown = useCallback(() => {
    setCooldownSeconds(RESEND_COOLDOWN_SECONDS);
  }, []);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setTimeout(() => {
      setCooldownSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownSeconds]);

  // Restore the password step after refresh when recovery verification
  // already succeeded (session present + non-sensitive UI flag).
  // Also handle Supabase PASSWORD_RECOVERY (e.g. recovery link click).
  useEffect(() => {
    let active = true;

    async function hydrateFromRecoverySession() {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (data.session && isRecoveryUiActive()) {
        setStep("password");
        setInfoMessage(
          "Verification succeeded. Create a new password to finish resetting your account."
        );
      }
    }

    void hydrateFromRecoverySession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY") {
        markRecoveryUiActive();
        setStep("password");
        setFormError(null);
        setInfoMessage(
          "Verification succeeded. Create a new password to finish resetting your account."
        );
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function sendRecoveryCode(targetEmail: string): Promise<boolean> {
    const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: `${window.location.origin}/forgot-password`,
    });

    if (!error) return true;
    if (isRateLimited(error)) {
      setFormError(friendlyAuthError(error, "Too many requests. Please wait and try again."));
      return false;
    }
    if (shouldTreatAsSent(error)) return true;

    setFormError(
      friendlyAuthError(error, "Unable to send a verification code right now. Please try again later.")
    );
    return false;
  }

  async function handleRequestCode(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setInfoMessage(null);

    const trimmed = email.trim();
    if (!trimmed) {
      setFormError("Email is required.");
      return;
    }
    if (!isValidEmail(trimmed)) {
      setFormError("Enter a valid email address.");
      return;
    }

    try {
      setSubmitting(true);
      const ok = await sendRecoveryCode(trimmed);
      if (!ok) return;

      setEmail(trimmed);
      setOtp("");
      setInfoMessage(GENERIC_CODE_SENT);
      setStep("verify");
      startCooldown();
    } catch {
      setFormError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (cooldownSeconds > 0 || submitting) return;
    setFormError(null);

    try {
      setSubmitting(true);
      const ok = await sendRecoveryCode(email.trim());
      if (!ok) return;
      setInfoMessage(GENERIC_CODE_SENT);
      startCooldown();
    } catch {
      setFormError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyCode(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const token = otp.trim();
    if (!token) {
      setFormError("Enter the verification code from your email.");
      return;
    }

    try {
      setSubmitting(true);
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token,
        type: "recovery",
      });

      if (error) {
        setFormError(
          friendlyAuthError(
            error,
            "That verification code is invalid or has expired. Request a new code and try again."
          )
        );
        return;
      }

      markRecoveryUiActive();
      setOtp("");
      setStep("password");
      setInfoMessage(null);
    } catch {
      setFormError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const passwordError = validateNewPassword(newPassword);
    if (passwordError) {
      setFormError(passwordError);
      return;
    }
    if (!confirmPassword) {
      setFormError("Confirm your new password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }

    try {
      setSubmitting(true);
      const { error } = await supabase.auth.updateUser({ password: newPassword });

      if (error) {
        setFormError(
          friendlyAuthError(
            error,
            "Unable to update your password. Request a new verification code and try again."
          )
        );
        if (
          error.message.toLowerCase().includes("session") ||
          error.message.toLowerCase().includes("auth session missing")
        ) {
          setStep("request");
        }
        return;
      }

      setNewPassword("");
      setConfirmPassword("");
      clearRecoveryUiFlag();
      await supabase.auth.signOut();
      setStep("done");
      setInfoMessage(null);
    } catch {
      setFormError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function goBackToLogin() {
    clearRecoveryUiFlag();
    router.push("/login");
  }

  function titleForStep(): string {
    switch (step) {
      case "request":
        return "Forgot Password";
      case "verify":
        return "Verify your email";
      case "password":
        return "Create a new password";
      case "done":
        return "Password updated successfully.";
    }
  }

  function descriptionForStep(): string {
    switch (step) {
      case "request":
        return "Enter your registered email address and we'll send you a verification code.";
      case "verify":
        return "Enter the verification code sent to your registered email.";
      case "password":
        return "Choose a new password for your account.";
      case "done":
        return "You can now sign in with your new password.";
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
          <CardTitle className="text-xl">{titleForStep()}</CardTitle>
          <CardDescription>{descriptionForStep()}</CardDescription>
        </CardHeader>

        <CardContent>
          {infoMessage && (
            <p className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
              {infoMessage}
            </p>
          )}

          {step === "request" && (
            <form className="space-y-4" onSubmit={handleRequestCode}>
              <FormField label="Email" htmlFor="forgot-email" required error={formError ?? undefined}>
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitting}
                  aria-invalid={Boolean(formError)}
                />
              </FormField>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Sending..." : "Send verification code"}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={goBackToLogin}
                disabled={submitting}
              >
                Back to Login
              </Button>
            </form>
          )}

          {step === "verify" && (
            <form className="space-y-4" onSubmit={handleVerifyCode}>
              <FormField
                label="Verification code"
                htmlFor="forgot-otp"
                required
                error={formError ?? undefined}
              >
                <Input
                  id="forgot-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Enter code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  disabled={submitting}
                  aria-invalid={Boolean(formError)}
                />
              </FormField>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Verifying..." : "Verify code"}
              </Button>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => void handleResend()}
                  disabled={submitting || cooldownSeconds > 0}
                >
                  {cooldownSeconds > 0 ? `Resend code (${cooldownSeconds}s)` : "Resend code"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setFormError(null);
                    setOtp("");
                    setStep("request");
                  }}
                  disabled={submitting}
                >
                  Back
                </Button>
              </div>
            </form>
          )}

          {step === "password" && (
            <form className="space-y-4" onSubmit={handleResetPassword}>
              <FormField
                label="New password"
                htmlFor="forgot-new-password"
                required
                hint={getPasswordRequirementHint()}
              >
                <Input
                  id="forgot-new-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={submitting}
                  aria-invalid={Boolean(formError)}
                />
              </FormField>

              <FormField label="Confirm new password" htmlFor="forgot-confirm-password" required>
                <Input
                  id="forgot-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={submitting}
                  aria-invalid={Boolean(formError)}
                />
              </FormField>

              {formError && (
                <p className="text-sm font-medium text-destructive" role="alert">
                  {formError}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Updating..." : "Reset password"}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setFormError(null);
                  setNewPassword("");
                  setConfirmPassword("");
                  clearRecoveryUiFlag();
                  void supabase.auth.signOut();
                  setStep("request");
                }}
                disabled={submitting}
              >
                Back
              </Button>
            </form>
          )}

          {step === "done" && (
            <div className="space-y-4">
              <p className="text-center text-sm text-muted-foreground">
                Password updated successfully.
              </p>
              <Button type="button" className="w-full" onClick={goBackToLogin}>
                Back to Login
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Or go directly to{" "}
                <Link href="/login" className="underline underline-offset-2">
                  Sign In
                </Link>
                .
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
