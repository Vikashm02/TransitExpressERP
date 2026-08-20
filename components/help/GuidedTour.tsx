"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth/AuthProvider";
import { useLearningMode } from "@/lib/help/LearningModeProvider";
import {
  clearTourSeen,
  hasSeenTour,
  markTourSeen,
} from "@/lib/help/tourStorage";
import type { HelpTourStep } from "@/lib/help/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface GuidedTourProps {
  pageId: string;
  steps: HelpTourStep[];
  /** When true, open immediately (replay). Auto first-visit uses localStorage. */
  forceOpen?: boolean;
  onForceOpenHandled?: () => void;
}

/**
 * Lightweight 3–6 step tour. Non-blocking; dismissible.
 * Tour-seen state is localStorage; Learning Mode stays DB-backed.
 */
export default function GuidedTour({
  pageId,
  steps,
  forceOpen = false,
  onForceOpenHandled,
}: GuidedTourProps) {
  const { user } = useAuth();
  const { learningMode, loading } = useLearningMode();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const safeSteps = steps.slice(0, 6);
  const step = safeSteps[index];
  const isLast = index >= safeSteps.length - 1;

  const closeAndMark = useCallback(() => {
    setOpen(false);
    setIndex(0);
    if (user?.id) markTourSeen(pageId, user.id);
  }, [pageId, user?.id]);

  useEffect(() => {
    if (loading || !learningMode || !user?.id || safeSteps.length === 0) {
      return;
    }

    if (forceOpen) {
      clearTourSeen(pageId, user.id);
      setIndex(0);
      setOpen(true);
      onForceOpenHandled?.();
      return;
    }

    if (!hasSeenTour(pageId, user.id)) {
      setIndex(0);
      setOpen(true);
    }
  }, [
    loading,
    learningMode,
    user?.id,
    pageId,
    forceOpen,
    onForceOpenHandled,
    safeSteps.length,
  ]);

  // Hide tour UI entirely when Learning Mode is off
  useEffect(() => {
    if (!learningMode) {
      setOpen(false);
      setIndex(0);
    }
  }, [learningMode]);

  if (!step || safeSteps.length === 0) return null;

  return (
    <Dialog
      open={open && learningMode}
      onOpenChange={(next) => {
        if (!next) closeAndMark();
        else setOpen(true);
      }}
    >
      <DialogContent className="max-w-[min(22rem,calc(100vw-1.5rem))] gap-4 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="pr-6 text-base">{step.title}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-foreground">
            {step.body}
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Step {index + 1} / {safeSteps.length}
        </p>
        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={closeAndMark}
          >
            छोड़ें
          </Button>
          <div className="flex gap-2">
            {index > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                पीछे
              </Button>
            ) : null}
            {isLast ? (
              <Button type="button" size="sm" onClick={closeAndMark}>
                समझ गया
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  setIndex((i) => Math.min(safeSteps.length - 1, i + 1))
                }
              >
                आगे
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
