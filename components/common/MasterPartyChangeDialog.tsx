"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";
import { getUserFacingError } from "@/lib/errors/getUserFacingError";
import {
  applyMasterPartyChange,
  type MasterPartyChangePreview,
} from "@/components/services/masterPartyChange.service";

interface MasterPartyChangeDialogProps {
  partyId: number | null;
  preview: MasterPartyChangePreview | null;
  onClose: () => void;
}

/**
 * Shown after a customer / billing party's name, GST or address is changed in
 * the master: asks whether older records should take the new details. Bills
 * are a separate, unticked, warned choice because issued bills are GST
 * documents.
 */
export default function MasterPartyChangeDialog({ partyId, preview, onClose }: MasterPartyChangeDialogProps) {
  const [updateRecords, setUpdateRecords] = useState(true);
  const [updateBills, setUpdateBills] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!preview || partyId === null) return null;
  const isBillingParty = preview.partyType === "billing_party";
  const label = isBillingParty ? "billing party" : "customer";

  const changes: { field: string; from: string; to: string }[] = [];
  if (preview.changed.name) changes.push({ field: "Name", from: preview.oldValues.name, to: preview.newValues.name });
  if (preview.changed.gst) changes.push({ field: "GST number", from: preview.oldValues.gst, to: preview.newValues.gst });
  if (preview.changed.address) changes.push({ field: "Address", from: preview.oldValues.address, to: preview.newValues.address });

  const usage = [
    { label: "LRs", count: preview.lrs },
    { label: "Delivery Challans", count: preview.deliveryChallans },
    { label: "POs", count: preview.purchaseOrders },
    { label: "Bids", count: preview.bids },
    { label: "Consignee conversations", count: preview.conversations },
  ].filter((u) => u.count > 0);

  async function finish(action: "apply" | "apply_with_bills" | "skip") {
    if (partyId === null) return;
    setSaving(true);
    try {
      await applyMasterPartyChange(preview!.partyType, partyId, action);
      if (action === "skip") {
        toast.success("Saved. Older records keep their previous details.");
      } else {
        const parts = usage.map((u) => `${u.count} ${u.label}`);
        if (action === "apply_with_bills") parts.push(`${preview!.bills} bills`);
        toast.success(parts.length ? `Updated ${parts.join(", ")} with the new details.` : "Saved.");
      }
      onClose();
    } catch (error) {
      toast.error(getUserFacingError(error, "Could not update the older records. Nothing was changed; please try again."));
    } finally {
      setSaving(false);
    }
  }

  const primaryAction = updateBills && preview.bills > 0 ? "apply_with_bills" : updateRecords ? "apply" : "skip";

  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        // Closing without choosing keeps the decision open: the next edit of
        // this party asks again (older records stay as they are until then).
        if (!open && !saving) {
          toast.info("No decision taken. Older records are unchanged for now.");
          onClose();
        }
      }}
      title="Update older records?"
      description={`You changed this ${label}'s details. Choose where the new details should also appear.`}
      loading={saving}
      loadingText="Updating older records..."
      footer={
        <>
          <Button variant="outline" disabled={saving} onClick={() => void finish("skip")}>
            Don&apos;t update old records
          </Button>
          <Button disabled={saving} onClick={() => void finish(primaryAction)}>
            {primaryAction === "skip" ? "Save without updating" : "Approve and update"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
          {changes.map((c) => (
            <p key={c.field}>
              <span className="text-muted-foreground">{c.field}: </span>
              <span className="line-through decoration-muted-foreground/60">{c.from || "—"}</span>
              <span className="mx-1.5 text-muted-foreground">→</span>
              <span className="font-medium">{c.to || "—"}</span>
            </p>
          ))}
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={updateRecords}
            onChange={(e) => setUpdateRecords(e.target.checked)}
            disabled={saving}
          />
          <span>
            <span className="font-medium">Update older records with the new details</span>
            <span className="mt-1 block text-muted-foreground">
              {usage.length
                ? `Used in ${usage.map((u) => `${u.count} ${u.label}`).join(", ")}.`
                : "Not used in any LR, DC, PO or Bid."}{" "}
              Financials and reports follow the LRs.
            </span>
          </span>
        </label>

        {isBillingParty && preview.bills > 0 ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={updateBills}
              onChange={(e) => setUpdateBills(e.target.checked)}
              disabled={saving}
            />
            <span>
              <span className="flex items-center gap-1.5 font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                Also update the {preview.bills} existing {preview.bills === 1 ? "bill" : "bills"}!
              </span>
              <span className="mt-1 block text-destructive/90">
                These bills were already issued and are GST documents. Changing the billing party
                name, address or GST on them can create a mismatch with the copy the party has and
                with your GST filing (GSTR-1). Tick this only if you are sure, for example when the
                party itself asked for the correction.
              </span>
              <span className="mt-1 block text-muted-foreground">
                If not ticked, the bills keep the details printed on them.
              </span>
            </span>
          </label>
        ) : null}

        {preview.olderLrsNotMatched > 0 ? (
          <p className="rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            {preview.olderLrsNotMatched} older {preview.olderLrsNotMatched === 1 ? "LR uses" : "LRs use"} a name that
            another master record also has, so {preview.olderLrsNotMatched === 1 ? "it was" : "they were"} not
            matched automatically. Update {preview.olderLrsNotMatched === 1 ? "it" : "them"} from the LR if needed.
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}
