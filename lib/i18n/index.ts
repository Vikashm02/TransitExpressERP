export type { Locale, TranslationDict } from "./types";
export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_STORAGE_KEY,
} from "./types";
export { LanguageProvider, useLanguage, useLanguageOptional } from "./LanguageProvider";
export { translate, getDictionary } from "./dictionaries";
