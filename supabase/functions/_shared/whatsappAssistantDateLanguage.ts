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

export const CURRENT_MONTH_PATTERN = CURRENT_MONTH_ALIASES.map(escapeRegex).join("|");

const currentMonthAliases = new Set<string>(CURRENT_MONTH_ALIASES);

export function isCurrentMonthAlias(value: string): boolean {
  return currentMonthAliases.has(value.toLowerCase());
}
