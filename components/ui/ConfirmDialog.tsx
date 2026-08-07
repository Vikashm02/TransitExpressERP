"use client";

import type { VariantProps } from "class-variance-authority";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { type buttonVariants } from "@/components/ui/button";

type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Visual style of the confirm button. Defaults to "destructive" (the most common use case: delete confirmations). */
  variant?: ButtonVariant;
  /** Disables both actions and swaps the confirm label while an async action is in flight. */
  loading?: boolean;
  onConfirm: () => void;
}

/**
 * Generic confirmation dialog for any destructive or otherwise consequential
 * action across the ERP (delete, cancel, deactivate, etc). Carries no
 * domain-specific logic — callers own the copy and the `onConfirm` handler.
 */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "destructive",
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  function handleOpenChange(next: boolean) {
    // Prevent dismissing the dialog (backdrop click / escape) while the
    // confirmed action is still in flight.
    if (loading && !next) return;
    onOpenChange(next);
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={handleOpenChange}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {title}
          </AlertDialogTitle>

          {description && (
            <AlertDialogDescription>
              {description}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>
            {cancelLabel}
          </AlertDialogCancel>

          <AlertDialogAction
            variant={variant}
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? "Please wait..." : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
