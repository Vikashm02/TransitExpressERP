"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase";
import { AUTH_PASSWORD_MIN_LENGTH } from "@/lib/auth/passwordPolicy";
import { useLanguage } from "@/lib/i18n";
import LanguageSelector from "@/components/layout/LanguageSelector";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import FormField from "@/components/ui/FormField";

type Step = "request" | "verify" | "password" | "done";
type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

const RESEND_COOLDOWN_SECONDS = 60;
/** Non-sensitive UI flag only — never stores passwords, OTPs, or tokens. */
const RECOVERY_UI_FLAG = "erp_password_recovery";

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

function friendlyAuthError(
  error: unknown,
  fallbackKey: string,
  t: TranslateFn
): string {
  if (!(error instanceof Error) || !error.message) return t(fallbackKey);

  const message = error.message.toLowerCase();

  if (
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("email rate limit")
  ) {
    return t("auth.forgot.rateLimited");
  }

  if (
    message.includes("otp") ||
    message.includes("token") ||
    message.includes("expired") ||
    message.includes("invalid")
  ) {
    if (message.includes("password")) {
      return t("auth.forgot.passwordNotStrong");
    }
    return t("auth.forgot.invalidOrExpiredCode");
  }

  if (message.includes("same password") || message.includes("different from the old")) {
    return t("auth.forgot.differentPassword");
  }

  if (message.includes("network") || message.includes("fetch")) {
    return t("auth.forgot.networkError");
  }

  if (message.includes("session") || message.includes("auth session missing")) {
    return t("auth.forgot.sessionExpired");
  }

  // Never surface raw Auth/database internals.
  return t(fallbackKey);
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

function localPasswordError(password: string, t: TranslateFn): string | null {
  if (!password) return t("auth.forgot.newPasswordRequired");
  if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
    return t("auth.forgot.passwordTooShort", { min: AUTH_PASSWORD_MIN_LENGTH });
  }
  return null;
}

/**
 * Forgot / reset password via Supabase Auth recovery OTP.
 * Does not store OTPs or reset codes in the app database.
 */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const { t } = useLanguage();

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
        setInfoMessage(t("auth.forgot.verificationSucceeded"));
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
        setInfoMessage(t("auth.forgot.verificationSucceeded"));
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [t]);

  async function sendRecoveryCode(targetEmail: string): Promise<boolean> {
    const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: `${window.location.origin}/forgot-password`,
    });

    if (!error) return true;
    if (isRateLimited(error)) {
      setFormError(friendlyAuthError(error, "auth.forgot.rateLimited", t));
      return false;
    }
    if (shouldTreatAsSent(error)) return true;

    setFormError(friendlyAuthError(error, "auth.forgot.unableToSend", t));
    return false;
  }

  async function handleRequestCode(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setInfoMessage(null);

    const trimmed = email.trim();
    if (!trimmed) {
      setFormError(t("auth.forgot.emailRequired"));
      return;
    }
    if (!isValidEmail(trimmed)) {
      setFormError(t("auth.forgot.invalidEmail"));
      return;
    }

    try {
      setSubmitting(true);
      const ok = await sendRecoveryCode(trimmed);
      if (!ok) return;

      setEmail(trimmed);
      setOtp("");
      setInfoMessage(t("auth.forgot.codeSent"));
      setStep("verify");
      startCooldown();
    } catch {
      setFormError(t("auth.forgot.networkError"));
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
      setInfoMessage(t("auth.forgot.codeSent"));
      startCooldown();
    } catch {
      setFormError(t("auth.forgot.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyCode(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const token = otp.trim();
    if (!token) {
      setFormError(t("auth.forgot.otpRequired"));
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
          friendlyAuthError(error, "auth.forgot.invalidOrExpiredCode", t)
        );
        return;
      }

      markRecoveryUiActive();
      setOtp("");
      setStep("password");
      setInfoMessage(null);
    } catch {
      setFormError(t("auth.forgot.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const passwordError = localPasswordError(newPassword, t);
    if (passwordError) {
      setFormError(passwordError);
      return;
    }
    if (!confirmPassword) {
      setFormError(t("auth.forgot.confirmRequired"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError(t("auth.forgot.passwordsDoNotMatch"));
      return;
    }

    try {
      setSubmitting(true);
      const { error } = await supabase.auth.updateUser({ password: newPassword });

      if (error) {
        setFormError(friendlyAuthError(error, "auth.forgot.unableToUpdate", t));
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
      setFormError(t("auth.forgot.networkError"));
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
        return t("auth.forgot.stepRequest");
      case "verify":
        return t("auth.forgot.stepVerify");
      case "password":
        return t("auth.forgot.stepPassword");
      case "done":
        return t("auth.forgot.stepDone");
    }
  }

  function descriptionForStep(): string {
    switch (step) {
      case "request":
        return t("auth.forgot.descRequest");
      case "verify":
        return t("auth.forgot.descVerify");
      case "password":
        return t("auth.forgot.descPassword");
      case "done":
        return t("auth.forgot.descDone");
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 sm:p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,oklch(0.345_0.09_252_/_0.18),transparent_55%),radial-gradient(ellipse_at_bottom_right,oklch(0.72_0.13_70_/_0.16),transparent_50%)]" />
      <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-[42%] bg-primary lg:block" />
      <div className="pointer-events-none absolute bottom-8 left-8 hidden max-w-sm text-primary-foreground lg:block">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-highlight">
          {t("auth.brandEyebrow")}
        </p>
        <p className="mt-2 font-heading text-3xl font-semibold tracking-tight">
          {t("auth.brandHeadline")}
        </p>
        <p className="mt-2 text-sm text-primary-foreground/75">{t("auth.brandSub")}</p>
      </div>

      <div className="absolute top-4 right-4 z-20 sm:top-6 sm:right-6">
        <LanguageSelector variant="segmented" />
      </div>

      <Card className="relative z-10 w-full max-w-md border-border/70 shadow-xl shadow-primary/10">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-primary/10 ring-1 ring-primary/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/icon-192.png"
              alt={t("auth.forgot.brandAlt")}
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
              <FormField
                label={t("auth.email")}
                htmlFor="forgot-email"
                required
                error={formError ?? undefined}
              >
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder={t("auth.emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitting}
                  aria-invalid={Boolean(formError)}
                />
              </FormField>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? t("auth.forgot.sending") : t("auth.forgot.sendCode")}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={goBackToLogin}
                disabled={submitting}
              >
                {t("auth.forgot.backToLogin")}
              </Button>
            </form>
          )}

          {step === "verify" && (
            <form className="space-y-4" onSubmit={handleVerifyCode}>
              <FormField
                label={t("auth.forgot.verificationCode")}
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
                  placeholder={t("auth.forgot.enterCode")}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  disabled={submitting}
                  aria-invalid={Boolean(formError)}
                />
              </FormField>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting
                  ? t("auth.forgot.verifying")
                  : t("auth.forgot.verifyCode")}
              </Button>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => void handleResend()}
                  disabled={submitting || cooldownSeconds > 0}
                >
                  {cooldownSeconds > 0
                    ? t("auth.forgot.resendCodeCooldown", {
                        seconds: cooldownSeconds,
                      })
                    : t("auth.forgot.resendCode")}
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
                  {t("auth.forgot.back")}
                </Button>
              </div>
            </form>
          )}

          {step === "password" && (
            <form className="space-y-4" onSubmit={handleResetPassword}>
              <FormField
                label={t("auth.forgot.newPassword")}
                htmlFor="forgot-new-password"
                required
                hint={t("auth.forgot.passwordHint", {
                  min: AUTH_PASSWORD_MIN_LENGTH,
                })}
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

              <FormField
                label={t("auth.forgot.confirmNewPassword")}
                htmlFor="forgot-confirm-password"
                required
              >
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
                {submitting
                  ? t("auth.forgot.updating")
                  : t("auth.forgot.resetPassword")}
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
                {t("auth.forgot.back")}
              </Button>
            </form>
          )}

          {step === "done" && (
            <div className="space-y-4">
              <p className="text-center text-sm text-muted-foreground">
                {t("auth.forgot.passwordUpdatedBody")}
              </p>
              <Button type="button" className="w-full" onClick={goBackToLogin}>
                {t("auth.forgot.backToLogin")}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {t("auth.forgot.orGoDirectly")}{" "}
                <Link href="/login" className="underline underline-offset-2">
                  {t("auth.signIn")}
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
