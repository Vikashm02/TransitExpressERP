const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const CURRENT_MONTH_ALIASES = [
  "this month",
  "ye month",
  "is month",
  "iss month",
  "is mahine",
  "iss mahine",
  "इस महीने",
] as const;

export const LAST_MONTH_ALIASES = [
  "last month",
  "pichle month",
  "pichhle month",
  "pichle mahine",
  "pichhle mahine",
  "पिछले महीने",
] as const;

export const CURRENT_MONTH_PATTERN = CURRENT_MONTH_ALIASES.map(escapeRegex).join("|");
export const LAST_MONTH_PATTERN = LAST_MONTH_ALIASES.map(escapeRegex).join("|");

const currentMonthAliases = new Set<string>(CURRENT_MONTH_ALIASES);
const lastMonthAliases = new Set<string>(LAST_MONTH_ALIASES);

export function isCurrentMonthAlias(value: string): boolean {
  return currentMonthAliases.has(value.toLowerCase());
}

export function isLastMonthAlias(value: string): boolean {
  return lastMonthAliases.has(value.toLowerCase());
}
