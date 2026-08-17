/**
 * Overview efficiency KPI thresholds — change here without hunting UI code.
 * Completion: average minutes. Quality: score percent.
 */
export const OVERVIEW_COMPLETION_THRESHOLDS = {
  /** <= this → green */
  greenMaxMinutes: 20,
  /** <= this (and > green) → yellow; above → red */
  yellowMaxMinutes: 40,
} as const;

export const OVERVIEW_QUALITY_THRESHOLDS = {
  /** >= this → green */
  greenMinPercent: 95,
  /** >= this (and < green) → yellow; below → red */
  yellowMinPercent: 90,
} as const;

export type OverviewTone = "success" | "warning" | "caution" | "critical" | "neutral";

export function completionTone(avgMinutes: number | null): OverviewTone {
  if (avgMinutes === null || !Number.isFinite(avgMinutes)) return "neutral";
  if (avgMinutes <= OVERVIEW_COMPLETION_THRESHOLDS.greenMaxMinutes) return "success";
  if (avgMinutes <= OVERVIEW_COMPLETION_THRESHOLDS.yellowMaxMinutes) return "warning";
  return "critical";
}

export function qualityTone(score: number | null): OverviewTone {
  if (score === null || !Number.isFinite(score)) return "neutral";
  if (score >= OVERVIEW_QUALITY_THRESHOLDS.greenMinPercent) return "success";
  if (score >= OVERVIEW_QUALITY_THRESHOLDS.yellowMinPercent) return "warning";
  return "critical";
}

export function ageBucketTone(
  bucket: "today" | "days_1_2" | "days_3_7" | "days_7_plus"
): OverviewTone {
  switch (bucket) {
    case "today":
      return "success";
    case "days_1_2":
      return "warning";
    case "days_3_7":
      return "caution";
    case "days_7_plus":
      return "critical";
  }
}

/** Tailwind classes for tone accents (text + soft bar). */
export function toneTextClass(tone: OverviewTone): string {
  switch (tone) {
    case "success":
      return "text-success";
    case "warning":
      return "text-warning-foreground";
    case "caution":
      return "text-highlight-foreground";
    case "critical":
      return "text-destructive";
    default:
      return "text-foreground";
  }
}

export function toneBarClass(tone: OverviewTone): string {
  switch (tone) {
    case "success":
      return "bg-success";
    case "warning":
      return "bg-warning";
    case "caution":
      return "bg-highlight";
    case "critical":
      return "bg-destructive";
    default:
      return "bg-muted-foreground";
  }
}

export function toneSoftBgClass(tone: OverviewTone): string {
  switch (tone) {
    case "success":
      return "bg-success/10";
    case "warning":
      return "bg-warning/15";
    case "caution":
      return "bg-highlight/20";
    case "critical":
      return "bg-destructive/10";
    default:
      return "bg-muted/50";
  }
}
