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
}

const STATUS_STYLES: Record<string, string> = {
  // Canonical set
  active: "bg-success/10 text-success",
  inactive: "bg-muted text-muted-foreground",
  pending: "bg-warning/10 text-warning",
  cancelled: "bg-destructive/10 text-destructive",
  canceled: "bg-destructive/10 text-destructive",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  error: "bg-destructive/10 text-destructive",

  // Common ERP domain aliases (LR / booking lifecycle, etc.)
  open: "bg-info/10 text-info",
  "in transit": "bg-info/10 text-info",
  delivered: "bg-info/10 text-info",
  billed: "bg-violet/10 text-violet",
  draft: "bg-muted text-muted-foreground",
  failed: "bg-destructive/10 text-destructive",
  rejected: "bg-destructive/10 text-destructive",
  approved: "bg-success/10 text-success",
  completed: "bg-success/10 text-success",

  // Vehicle master lifecycle / compliance aliases
  "under maintenance": "bg-warning/10 text-warning",
  sold: "bg-muted text-muted-foreground",
  valid: "bg-success/10 text-success",
  expiring: "bg-warning/10 text-warning",
  expired: "bg-destructive/10 text-destructive",
  missing: "bg-muted text-muted-foreground",

  // Reports — Outstanding Payment aging report's Payment Status
  overdue: "bg-destructive/10 text-destructive",
  "within cycle": "bg-success/10 text-success",
  "no outstanding": "bg-muted text-muted-foreground",
};

const DEFAULT_STYLE = "bg-muted text-muted-foreground";

export default function StatusBadge({
  status,
  label,
  className,
}: StatusBadgeProps) {
  const style = STATUS_STYLES[status?.toLowerCase().trim()] ?? DEFAULT_STYLE;

  return (
    <Badge
      variant="outline"
      className={cn("border-transparent font-medium", style, className)}
    >
      {label ?? status}
    </Badge>
  );
}
