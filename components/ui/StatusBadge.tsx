import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Canonical statuses every module should be able to render.
 * Any other string is still accepted (e.g. domain statuses like
 * "Delivered" or "Billed") and falls back to a neutral style.
 */
export type StatusBadgeStatus =
  | "Active"
  | "Inactive"
  | "Pending"
  | "Cancelled"
  | "Success"
  | "Warning"
  | "Error"
  | (string & {});

interface StatusBadgeProps {
  status: StatusBadgeStatus;
  /** Overrides the visible text while keeping the color derived from `status` */
  label?: string;
  className?: string;
  /** Adds a compact semantic dot before the label when the calling UI needs stronger status recognition. */
  showDot?: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  // Canonical set
  active: "bg-success/12 text-success ring-1 ring-success/20",
  inactive: "bg-muted text-muted-foreground ring-1 ring-border/60",
  pending: "bg-warning/15 text-warning-foreground ring-1 ring-warning/25",
  cancelled: "bg-destructive/10 text-destructive ring-1 ring-destructive/20",
  canceled: "bg-destructive/10 text-destructive ring-1 ring-destructive/20",
  success: "bg-success/12 text-success ring-1 ring-success/20",
  warning: "bg-warning/15 text-warning-foreground ring-1 ring-warning/25",
  error: "bg-destructive/10 text-destructive ring-1 ring-destructive/20",

  // Common ERP domain aliases (LR / booking lifecycle, etc.)
  open: "bg-info/12 text-info ring-1 ring-info/20",
  "in transit": "bg-info/12 text-info ring-1 ring-info/20",
  delivered: "bg-info/12 text-info ring-1 ring-info/20",
  billed: "bg-violet/12 text-violet ring-1 ring-violet/20",
  draft: "bg-muted text-muted-foreground ring-1 ring-border/60",
  failed: "bg-destructive/10 text-destructive ring-1 ring-destructive/20",
  rejected: "bg-destructive/10 text-destructive ring-1 ring-destructive/20",
  approved: "bg-success/12 text-success ring-1 ring-success/20",
  completed: "bg-success/12 text-success ring-1 ring-success/20",
  settled: "bg-success/12 text-success ring-1 ring-success/20",
  unsettled: "bg-warning/15 text-warning-foreground ring-1 ring-warning/25",

  // Bid lifecycle aliases
  live: "bg-green-500/15 text-green-700 ring-1 ring-green-500/25 dark:text-green-300",
  won: "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300",
  lost: "bg-red-500/15 text-red-700 ring-1 ring-red-500/25 dark:text-red-300",
  "not submitted": "bg-amber-500/15 text-amber-800 ring-1 ring-amber-500/25 dark:text-amber-200",

  // Vehicle master lifecycle / compliance aliases
  "under maintenance": "bg-warning/15 text-warning-foreground ring-1 ring-warning/25",
  sold: "bg-muted text-muted-foreground ring-1 ring-border/60",
  valid: "bg-success/12 text-success ring-1 ring-success/20",
  expiring: "bg-warning/15 text-warning-foreground ring-1 ring-warning/25",
  expired: "bg-destructive/10 text-destructive ring-1 ring-destructive/20",
  missing: "bg-muted text-muted-foreground ring-1 ring-border/60",

  // Reports — Outstanding Payment aging report's Payment Status
  overdue: "bg-destructive/10 text-destructive ring-1 ring-destructive/20",
  "within cycle": "bg-success/12 text-success ring-1 ring-success/20",
  "no outstanding": "bg-muted text-muted-foreground ring-1 ring-border/60",
};

const DEFAULT_STYLE = "bg-muted text-muted-foreground ring-1 ring-border/60";

const STATUS_DOT_STYLES: Record<string, string> = {
  live: "bg-green-600 dark:bg-green-400",
  won: "bg-emerald-600 dark:bg-emerald-400",
  lost: "bg-red-600 dark:bg-red-400",
  "not submitted": "bg-amber-600 dark:bg-amber-400",
  draft: "bg-muted-foreground/70",
  cancelled: "bg-destructive",
  canceled: "bg-destructive",
};

export default function StatusBadge({
  status,
  label,
  className,
  showDot = false,
}: StatusBadgeProps) {
  const key = status?.toLowerCase().trim();
  const style = STATUS_STYLES[key] ?? DEFAULT_STYLE;
  const dotStyle = STATUS_DOT_STYLES[key] ?? "bg-current/70";

  return (
    <Badge
      variant="outline"
      className={cn("border-transparent font-medium", style, className)}
    >
      {showDot && <span aria-hidden="true" className={cn("mr-1.5 size-1.5 shrink-0 rounded-full", dotStyle)} />}
      {label ?? status}
    </Badge>
  );
}
