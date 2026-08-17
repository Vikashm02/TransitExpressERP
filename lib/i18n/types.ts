export type Locale = "en" | "hi";

export const LOCALES: Locale[] = ["en", "hi"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "transjit.locale";

export type TranslationDict = Record<string, string>;
