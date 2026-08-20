"use client";

import { useState } from "react";
import { CircleHelp } from "lucide-react";

import { useLearningMode } from "@/lib/help/LearningModeProvider";
import type { PageHelpContent } from "@/lib/help/types";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface PageHelpProps {
  content: PageHelpContent;
  /** Replay tour callback — optional */
  onReplayTour?: () => void;
  className?: string;
}

/**
 * Compact page-level help entry. Visible only when Learning Mode is ON.
 */
export default function PageHelp({
  content,
  onReplayTour,
  className,
}: PageHelpProps) {
  const { learningMode, loading } = useLearningMode();
  const [open, setOpen] = useState(false);

  if (loading || !learningMode) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-8 gap-1.5 text-xs text-muted-foreground",
              className
            )}
            aria-label={content.title}
          />
        }
      >
        <CircleHelp className="h-3.5 w-3.5" />
        <span className="max-w-[11rem] truncate sm:max-w-none">
          यह पेज कैसे काम करता है?
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className="w-80 max-w-[min(20rem,calc(100vw-1.5rem))] gap-3 p-3"
      >
        <PopoverHeader>
          <PopoverTitle>{content.title}</PopoverTitle>
          <PopoverDescription className="sr-only">
            {content.title}
          </PopoverDescription>
        </PopoverHeader>
        <ul className="list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-foreground">
          {content.paragraphs.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        {onReplayTour ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={() => {
              setOpen(false);
              onReplayTour();
            }}
          >
            Tour दोबारा देखें
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
