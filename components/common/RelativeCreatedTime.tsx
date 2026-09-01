"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  formatAbsoluteCreatedAt,
  formatRelativeCreatedAt,
  getRelativeCreatedClock,
  getRelativeCreatedClockServer,
  subscribeRelativeCreatedClock,
  type CreatedTimestamp,
} from "@/lib/relativeCreatedTime";
import { cn } from "@/lib/utils";

interface RelativeCreatedTimeProps {
  value?: CreatedTimestamp;
  className?: string;
}

/**
 * List/cell display for record creation time: relative when recent,
 * absolute when older. Exact stamp on native tooltip (`title`).
 * Sorting must use the raw `created_at` via DataTable sortAccessor.
 */
export default function RelativeCreatedTime({
  value,
  className,
}: RelativeCreatedTimeProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const nowMs = useSyncExternalStore(
    subscribeRelativeCreatedClock,
    getRelativeCreatedClock,
    getRelativeCreatedClockServer
  );

  const absolute = formatAbsoluteCreatedAt(value);
  if (!absolute) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }

  const label = mounted
    ? formatRelativeCreatedAt(value, new Date(nowMs || Date.now())) ?? absolute
    : absolute;

  return (
    <span
      className={cn("whitespace-nowrap text-sm tabular-nums", className)}
      title={`Created: ${absolute}`}
      suppressHydrationWarning
    >
      {label}
    </span>
  );
}
