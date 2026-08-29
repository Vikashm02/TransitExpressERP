"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { LRRecord } from "@/components/services/lr.service";

interface PendingDraftLrsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drafts: LRRecord[];
  selectedId: LRRecord["id"] | null;
  onSelect: (id: LRRecord["id"]) => void;
  onOpenDraft: () => void;
  onCreateNew: () => void;
}

/**
 * Reminder before Create LR when the current user already has drafts.
 * Read-only — does not allocate LR numbers or modify records.
 */
export default function PendingDraftLrsDialog({
  open,
  onOpenChange,
  drafts,
  selectedId,
  onSelect,
  onOpenDraft,
  onCreateNew,
}: PendingDraftLrsDialogProps) {
  const count = drafts.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pending Draft LRs</DialogTitle>
          <DialogDescription>
            You have {count} pending LR draft{count === 1 ? "" : "s"}. Would you like to
            continue one of these drafts?
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-1">
          {drafts.map((draft) => {
            const selected = selectedId === draft.id;
            return (
              <li key={String(draft.id)}>
                <button
                  type="button"
                  onClick={() => onSelect(draft.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    selected
                      ? "bg-primary/10 font-medium text-foreground ring-1 ring-primary/30"
                      : "text-foreground hover:bg-muted/60"
                  }`}
                  aria-pressed={selected}
                >
                  <span
                    className={`h-3.5 w-3.5 shrink-0 rounded-full border ${
                      selected ? "border-primary bg-primary" : "border-muted-foreground/40"
                    }`}
                    aria-hidden
                  />
                  <span className="truncate font-medium">{draft.lrNumber || "Untitled draft"}</span>
                  {draft.consignor ? (
                    <span className="truncate text-xs text-muted-foreground">
                      · {draft.consignor}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={onCreateNew}>
            Create New LR
          </Button>
          <Button type="button" onClick={onOpenDraft} disabled={selectedId == null}>
            Open Draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
