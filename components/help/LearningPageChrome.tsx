"use client";

import { useCallback, useState } from "react";

import GuidedTour from "@/components/help/GuidedTour";
import PageHelp from "@/components/help/PageHelp";
import type { PageHelpContent } from "@/lib/help/types";
import { cn } from "@/lib/utils";

interface LearningPageChromeProps {
  content: PageHelpContent;
  className?: string;
  /** Place help control on the right of a page header row */
  align?: "start" | "end";
}

/**
 * PageHelp + GuidedTour wired together for a page.
 */
export default function LearningPageChrome({
  content,
  className,
  align = "end",
}: LearningPageChromeProps) {
  const [replay, setReplay] = useState(false);

  const clearReplay = useCallback(() => setReplay(false), []);

  return (
    <>
      <div
        className={cn(
          "flex",
          align === "end" ? "justify-end" : "justify-start",
          className
        )}
      >
        <PageHelp
          content={content}
          onReplayTour={() => setReplay(true)}
        />
      </div>
      <GuidedTour
        pageId={content.pageId}
        steps={content.tourSteps}
        forceOpen={replay}
        onForceOpenHandled={clearReplay}
      />
    </>
  );
}
