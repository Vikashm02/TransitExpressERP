import type { AppUserRole } from "@/components/services/appUser.service";

export interface HelpTourStep {
  title: string;
  body: string;
}

export interface PageHelpContent {
  pageId: string;
  /** Short title in the help popover */
  title: string;
  /** Bullet-style paragraphs — simple Hindi + product terms */
  paragraphs: string[];
  tourSteps: HelpTourStep[];
}

export type RoleAwarePageHelp = PageHelpContent & {
  /** If set, only these roles see this page help / tour. */
  roles?: AppUserRole[];
};

export function filterHelpForRole(
  content: RoleAwarePageHelp,
  role: AppUserRole | null | undefined
): PageHelpContent | null {
  if (content.roles && role && !content.roles.includes(role)) {
    return null;
  }
  if (content.roles && !role) return null;
  const { roles: _roles, ...rest } = content;
  return rest;
}
