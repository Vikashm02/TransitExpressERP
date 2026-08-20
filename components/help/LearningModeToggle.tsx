"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useLearningMode } from "@/lib/help/LearningModeProvider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface LearningModeToggleProps {
  className?: string;
}

/**
 * Profile Learning Mode ON/OFF control. Persists to user_preferences.
 */
export default function LearningModeToggle({
  className,
}: LearningModeToggleProps) {
  const { learningMode, loading, setLearningMode } = useLearningMode();
  const [busy, setBusy] = useState(false);

  async function handleToggle(next: boolean) {
    if (busy || loading || next === learningMode) return;
    setBusy(true);
    try {
      await setLearningMode(next);
      toast.success(
        next
          ? "Learning Mode चालू हो गया।"
          : "Learning Mode बंद हो गया।"
      );
    } catch (error) {
      console.error(error);
      toast.error("Learning Mode save नहीं हो सका। फिर कोशिश करें।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <p className="text-sm font-medium text-foreground">Learning Mode</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Learning Mode चालू होने पर आपको pages और fields के बारे में
          छोटी-छोटी मदद दिखाई जाएगी।
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={!learningMode ? "default" : "outline"}
          disabled={busy || loading}
          className={cn(!learningMode && "pointer-events-none")}
          onClick={() => void handleToggle(false)}
        >
          OFF
        </Button>
        <Button
          type="button"
          size="sm"
          variant={learningMode ? "default" : "outline"}
          disabled={busy || loading}
          className={cn(learningMode && "pointer-events-none")}
          onClick={() => void handleToggle(true)}
        >
          ON
        </Button>
      </div>
    </div>
  );
}
