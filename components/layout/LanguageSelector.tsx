"use client";

import { Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useLanguage, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface LanguageSelectorProps {
  className?: string;
  /** Compact header control vs. labeled control on auth screens. */
  variant?: "icon" | "segmented";
}

/**
 * Personal language preference (English / Hindi). Persists in localStorage.
 * Does not change other users' language.
 */
export default function LanguageSelector({
  className,
  variant = "icon",
}: LanguageSelectorProps) {
  const { locale, setLocale, t } = useLanguage();

  function cycleLocale() {
    const next: Locale = locale === "en" ? "hi" : "en";
    setLocale(next);
  }

  if (variant === "segmented") {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1 rounded-lg border border-border/80 bg-card p-1",
          className
        )}
        role="group"
        aria-label={t("common.language")}
      >
        <Button
          type="button"
          size="sm"
          variant={locale === "en" ? "default" : "ghost"}
          onClick={() => setLocale("en")}
          aria-pressed={locale === "en"}
        >
          {t("common.english")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={locale === "hi" ? "default" : "ghost"}
          onClick={() => setLocale("hi")}
          aria-pressed={locale === "hi"}
        >
          {t("common.hindi")}
        </Button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={`${t("common.language")}: ${locale === "en" ? t("common.english") : t("common.hindi")}`}
      aria-label={`${t("common.language")}: ${locale === "en" ? t("common.english") : t("common.hindi")}`}
      onClick={cycleLocale}
      className={cn("relative text-muted-foreground hover:text-foreground", className)}
    >
      <Languages className="h-4 w-4" />
      <span className="absolute -right-0.5 -bottom-0.5 rounded bg-primary px-1 text-[9px] font-semibold leading-4 text-primary-foreground">
        {locale === "en" ? "EN" : "हिं"}
      </span>
    </Button>
  );
}
