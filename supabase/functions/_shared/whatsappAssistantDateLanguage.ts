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

// A postposition is part of a reviewed relative-month phrase only when it
// immediately follows a recognized alias. Standalone `me`/`mein`/`में` remain
// ordinary input rather than becoming generic date grammar.
export const RELATIVE_MONTH_POSTPOSITION_PATTERN = "(?:\\s+(?:mein|me|में))?";
export const RELATIVE_MONTH_PHRASE_PATTERN = `(?:${CURRENT_MONTH_PATTERN}|${LAST_MONTH_PATTERN})${RELATIVE_MONTH_POSTPOSITION_PATTERN}`;

const currentMonthAliases = new Set<string>(CURRENT_MONTH_ALIASES);
const lastMonthAliases = new Set<string>(LAST_MONTH_ALIASES);

function relativeMonthBase(value: string): string {
  return value.trim().replace(/\s+(?:mein|me|में)$/iu, "").trim().toLowerCase();
}

export function isCurrentMonthAlias(value: string): boolean {
  return currentMonthAliases.has(relativeMonthBase(value));
}

export function isLastMonthAlias(value: string): boolean {
  return lastMonthAliases.has(relativeMonthBase(value));
}
