/**
 * Client-only staff profile preferences (localStorage).
 * Theme is managed by next-themes (see AppThemeProvider).
 * No database table — Phase 1 safe scope.
 */

export const PROFILE_LANDING_KEY = "transjit.profile.landingPage";

export const LANDING_PAGE_OPTIONS = [
  { value: "/", labelKey: "profile.landing.dashboard" },
  { value: "/lr", labelKey: "profile.landing.lr" },
  { value: "/pod", labelKey: "profile.landing.pod" },
  { value: "/profile", labelKey: "profile.landing.profile" },
] as const;

export type LandingPageValue = (typeof LANDING_PAGE_OPTIONS)[number]["value"];

export function readDefaultLandingPage(): LandingPageValue {
  if (typeof window === "undefined") return "/";
  try {
    const raw = window.localStorage.getItem(PROFILE_LANDING_KEY);
    if (LANDING_PAGE_OPTIONS.some((opt) => opt.value === raw)) {
      return raw as LandingPageValue;
    }
  } catch {
    // ignore
  }
  return "/";
}

export function writeDefaultLandingPage(path: LandingPageValue): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROFILE_LANDING_KEY, path);
  } catch {
    // ignore
  }
}
