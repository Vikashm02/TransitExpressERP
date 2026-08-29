"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { findMissingLrNumbers } from "@/lib/lrNumberGaps";
import { cn } from "@/lib/utils";

const PREVIEW_COUNT = 8;

interface LrSeriesStatusProps {
  lrNumbers: string[];
  className?: string;
}

/**
 * Compact, read-only banner for gaps between existing LR numbers.
 * Does not allocate or modify any LR.
 */
export default function LrSeriesStatus({ lrNumbers, className }: LrSeriesStatusProps) {
  const [expanded, setExpanded] = useState(false);

  const missing = useMemo(() => findMissingLrNumbers(lrNumbers), [lrNumbers]);

  if (missing.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground",
          className
        )}
      >
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        <span className="font-medium text-foreground">LR Series Complete</span>
        <span className="text-xs">No gaps between existing LR numbers.</span>
      </div>
    );
  }

  const preview = expanded ? missing : missing.slice(0, PREVIEW_COUNT);
  const hiddenCount = missing.length - preview.length;

  return (
    <div
      className={cn(
        "rounded-lg border border-amber-500/35 bg-amber-500/5 px-3 py-2.5 text-sm",
        className
      )}
      role="status"
    >
      <div className="flex flex-wrap items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="font-semibold text-foreground">Missing LR Numbers</p>
            <p className="text-xs text-muted-foreground">
              {missing.length} missing number{missing.length === 1 ? "" : "s"} in the series
            </p>
          </div>
          <p className="break-words font-medium text-foreground/90">
            {preview.join(" · ")}
            {hiddenCount > 0 && !expanded ? (
              <span className="font-normal text-muted-foreground">
                {" "}
                · and {hiddenCount} more
              </span>
            ) : null}
          </p>
          {missing.length > PREVIEW_COUNT ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded ? (
                <>
                  <ChevronUp className="mr-1 h-3.5 w-3.5" />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown className="mr-1 h-3.5 w-3.5" />
                  Show all {missing.length}
                </>
              )}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
