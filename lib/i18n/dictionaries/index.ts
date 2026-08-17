import type { Locale, TranslationDict } from "../types";
import { DEFAULT_LOCALE } from "../types";
import en from "./en";
import hi from "./hi";

const dictionaries: Record<Locale, TranslationDict> = {
  en,
  hi,
};

export function getDictionary(locale: Locale): TranslationDict {
  return dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
}

/**
 * Resolve a translation key. Falls back to English, then the key itself.
 * Supports simple `{name}` interpolation from `params`.
 */
export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>
): string {
  const primary = getDictionary(locale)[key];
  const fallback = locale === "en" ? undefined : en[key];
  let text = primary ?? fallback ?? key;

  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }

  return text;
}
