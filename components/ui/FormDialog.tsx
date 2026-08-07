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
  fullscreen: "w-[98vw] max-w-none h-[96vh] max-h-none rounded-2xl overflow-hidden p-0",
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
      <DialogContent className={cn(SIZE_CLASSES[size], "relative", className)}>
        <DialogHeader className={isFullscreen ? "border-b bg-card px-8 py-6" : undefined}>
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
          className={
            isFullscreen
              ? "h-[calc(96vh-89px)] overflow-y-auto bg-muted/30 px-8 py-8"
              : "overflow-y-auto"
          }
        >
          {children}
        </div>

        {footer && (
          <DialogFooter className={isFullscreen ? "border-t bg-card px-8 py-4" : undefined}>
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
