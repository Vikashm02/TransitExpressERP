"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type FormDialogSize = "default" | "lg" | "xl" | "fullscreen";

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /**
   * "default" / "lg" / "xl" render as a centered modal (like the current
   * Customer/Vehicle/Driver/Transporter dialogs).
   * "fullscreen" renders the near-full-viewport treatment (like the LR dialog).
   */
  size?: FormDialogSize;
  /** Shows a blocking overlay with `loadingText` (e.g. while saving) */
  loading?: boolean;
  loadingText?: string;
  /** Action buttons, typically Cancel + Save */
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

const SIZE_CLASSES: Record<FormDialogSize, string> = {
  default: "sm:max-w-3xl",
  lg: "sm:max-w-4xl",
  xl: "sm:max-w-6xl",
  // `sm:max-w-none` is required, not just `max-w-none`: the base DialogContent
  // sets `sm:max-w-sm` (a `sm:`-modified utility). tailwind-merge only cancels
  // classes that share the same modifier, so an unprefixed `max-w-none` alone
  // never overrides `sm:max-w-sm` — at >=640px the dialog would silently stay
  // capped at 384px regardless of `w-[98vw]`.
  fullscreen: "w-[98vw] max-w-none sm:max-w-none h-[96vh] max-h-none rounded-2xl overflow-hidden p-0",
};

export default function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  size = "default",
  loading = false,
  loadingText = "Saving...",
  footer,
  children,
  className,
}: FormDialogProps) {
  const isFullscreen = size === "fullscreen";

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      {/*
        Root cause (confirmed via computed styles in DevTools): the base
        DialogContent relies on `fixed top-1/2 left-1/2
        -translate-x-1/2 -translate-y-1/2` to center against the viewport.
        This override previously appended a `relative` class (meant only to
        anchor the absolute-positioned loading overlay below). Because
        `fixed` and `relative` are the same `position` utility group,
        tailwind-merge silently dropped the base `fixed` in favor of this
        `relative`, so the dialog was positioned relative to its own
        static-flow containing block (the portal, deep in normal document
        flow) instead of the viewport — landing it far below the fold.
        `fixed` already establishes a containing block for the
        `absolute inset-0` loading overlay, so `relative` was both
        redundant and the actual cause of the bug; it must not be
        reintroduced here.

        Separately, the base centering math never clamps height to the
        viewport, so a dialog taller than the visible area would still push
        its header off-screen with no way to scroll to it. `max-h-[90vh]`
        plus a scrollable body (`flex-1 overflow-y-auto` below) fixes that
        without affecting short dialogs, which simply size to their content
        as before.
      */}
      <DialogContent
        className={cn(
          "flex max-h-[90vh] flex-col overflow-hidden",
          SIZE_CLASSES[size],
          className
        )}
      >
        <DialogHeader
          className={cn("shrink-0", isFullscreen && "border-b bg-card px-4 py-4 sm:px-8 sm:py-6")}
        >
          <DialogTitle className={isFullscreen ? "text-2xl font-semibold" : undefined}>
            {title}
          </DialogTitle>

          {description && (
            <DialogDescription>
              {description}
            </DialogDescription>
          )}
        </DialogHeader>

        <div
          className={cn(
            "min-h-0",
            isFullscreen
              ? "h-[calc(96vh-89px)] overflow-y-auto bg-muted/30 px-4 py-5 sm:px-8 sm:py-8"
              : "flex-1 overflow-y-auto"
          )}
        >
          {children}
        </div>

        {footer && (
          <DialogFooter
            className={cn("shrink-0", isFullscreen && "border-t bg-card px-4 py-3 sm:px-8 sm:py-4")}
          >
            {footer}
          </DialogFooter>
        )}

        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/70 backdrop-blur-sm">
            <div className="rounded-xl border bg-card px-8 py-5 shadow-lg">
              <p className="font-semibold text-foreground">
                {loadingText}
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
