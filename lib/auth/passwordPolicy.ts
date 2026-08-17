/**
 * Client-side password rules for auth screens.
 *
 * The app has no shared password policy elsewhere (login/sign-up only
 * require a non-empty password). Supabase Auth defaults to a minimum
 * of 6 characters — keep this aligned so we do not invent a second
 * policy that the project has not configured.
 */
export const AUTH_PASSWORD_MIN_LENGTH = 6;

export function getPasswordRequirementHint(): string {
  return `At least ${AUTH_PASSWORD_MIN_LENGTH} characters.`;
}

export function validateNewPassword(password: string): string | null {
  if (!password) return "New password is required.";
  if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`;
  }
  return null;
}
