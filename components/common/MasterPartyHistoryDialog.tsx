"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import FormDialog from "@/components/ui/FormDialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { formatCreatedOn } from "@/lib/exportColumns";
import { getUserFacingError } from "@/lib/errors/getUserFacingError";
import {
  getMasterPartyHistory,
  undoMasterPartyUpdate,
  type MasterPartyHistoryEntry,
  type MasterPartyType,
} from "@/components/services/masterPartyChange.service";

interface MasterPartyHistoryDialogProps {
  partyType: MasterPartyType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reload the master list after an undo. */
  onUndone: () => void;
}

function changeLines(entry: MasterPartyHistoryEntry) {
  const lines: string[] = [];
  const { oldValues: o, newValues: n } = entry;
  if (o.name !== n.name) lines.push(`Name: ${o.name || "—"} → ${n.name || "—"}`);
  if (o.gst !== n.gst) lines.push(`GST: ${o.gst || "—"} → ${n.gst || "—"}`);
  if (o.address !== n.address) lines.push(`Address: ${o.address || "—"} → ${n.address || "—"}`);
  if (o.city !== n.city) lines.push(`City: ${o.city || "—"} → ${n.city || "—"}`);
  return lines;
}

function usageLine(entry: MasterPartyHistoryEntry) {
  const s = entry.summary ?? {};
  const parts = [
    ["LRs", s.lrs], ["DCs", s.deliveryChallans], ["POs", s.purchaseOrders], ["Bids", s.bids], ["conversations", s.conversations],
  ]
    .map(([label, count]) => [label, Number(count ?? 0)] as const)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${count} ${label}`);
  if (entry.includeBills) parts.push(`${Number(s.bills ?? 0)} bills`);
  return parts.length ? `Updated ${parts.join(", ")}` : "No older records needed updating";
}

/** Approved master updates with Undo (migration 119). */
export default function MasterPartyHistoryDialog({ partyType, open, onOpenChange, onUndone }: MasterPartyHistoryDialogProps) {
  const [entries, setEntries] = useState<MasterPartyHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [undoTarget, setUndoTarget] = useState<MasterPartyHistoryEntry | null>(null);
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getMasterPartyHistory(partyType)
      .then((rows) => { if (!cancelled) setEntries(rows); })
      .catch((error) => { if (!cancelled) toast.error(getUserFacingError(error, "Could not load the change history.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, partyType]);

  async function confirmUndo() {
    if (!undoTarget) return;
    setUndoing(true);
    try {
      const result = await undoMasterPartyUpdate(undoTarget.id);
      toast.success(
        `Undone. ${result.valuesRestored} values put back.` +
          (result.changedSinceAndKept > 0
            ? ` ${result.changedSinceAndKept} values were changed again since, so they were kept.`
            : "")
      );
      setUndoTarget(null);
      setEntries(await getMasterPartyHistory(partyType));
      onUndone();
    } catch (error) {
      toast.error(getUserFacingError(error, "Could not undo this update. Nothing was changed."));
    } finally {
      setUndoing(false);
    }
  }

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Change history"
        description="Name, GST and address changes that were applied to older records. Undo puts everything back."
        loading={loading}
      >
        <div className="space-y-3 text-sm">
          {entries.length === 0 && !loading ? (
            <p className="text-muted-foreground">No changes have been applied to older records yet.</p>
          ) : null}
          {entries.map((entry) => (
            <div key={entry.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  {changeLines(entry).map((line) => (
                    <p key={line} className="break-words font-medium">{line}</p>
                  ))}
                  <p className="text-muted-foreground">{usageLine(entry)}</p>
                  <p className="text-xs text-muted-foreground">
                    By {entry.appliedByName || "Unknown user"} on {formatCreatedOn(entry.appliedAt)}
                  </p>
                  {entry.undoneAt ? (
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                      Undone by {entry.undoneByName || "Unknown user"} on {formatCreatedOn(entry.undoneAt)}
                    </p>
                  ) : null}
                </div>
                {!entry.undoneAt ? (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setUndoTarget(entry)}>
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    Undo
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </FormDialog>

      <ConfirmDialog
        open={undoTarget !== null}
        onOpenChange={(o) => { if (!o && !undoing) setUndoTarget(null); }}
        title="Undo this update?"
        description={
          undoTarget
            ? `This puts back the previous details (${changeLines(undoTarget).join("; ")}) on the master and on the ${undoTarget.valuesChanged} values that were updated` +
              (undoTarget.includeBills ? ", including the bills" : "") +
              ". Anything changed again since is kept as it is."
            : undefined
        }
        confirmLabel="Undo"
        loading={undoing}
        onConfirm={confirmUndo}
      />
    </>
  );
}
