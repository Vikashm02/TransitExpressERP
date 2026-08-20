"use client";

import { CircleHelp } from "lucide-react";

import { useLearningMode } from "@/lib/help/LearningModeProvider";
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

interface FieldHelpProps {
  text: string;
  /** Optional short label shown in the popover title */
  label?: string;
  className?: string;
}

/**
 * Tap-friendly ⓘ control. Hidden when Learning Mode is OFF.
 * Uses Popover (not hover) so mobile works.
 */
export default function FieldHelp({ text, label, className }: FieldHelpProps) {
  const { learningMode, loading } = useLearningMode();

  if (loading || !learningMode || !text.trim()) return null;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground",
              className
            )}
            aria-label={label ? `Help: ${label}` : "Field help"}
          />
        }
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64 max-w-[min(18rem,calc(100vw-2rem))] p-3">
        <PopoverHeader>
          {label ? <PopoverTitle className="text-sm">{label}</PopoverTitle> : null}
          <PopoverDescription className="text-sm leading-relaxed text-foreground">
            {text}
          </PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  );
}
