"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FormDialog from "@/components/ui/FormDialog";
import FormField from "@/components/ui/FormField";
import FormDatePicker from "@/components/ui/FormDatePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCompany } from "@/components/services/company.service";
import { reserveLrNumber } from "@/components/services/lr.service";
import { getUserFacingError } from "@/lib/errors/getUserFacingError";

interface ReserveLrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReserved: () => void | Promise<void>;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Reserve one future LR number (migration 128) — the rare case where a
 * number above the running sequence was already given out. It is saved as a
 * draft LR with that number; the normal sequence does not move and skips it
 * when it gets there.
 */
export default function ReserveLrDialog({ open, onOpenChange, onReserved }: ReserveLrDialogProps) {
  const [rawNumber, setRawNumber] = useState("");
  const [lrDate, setLrDate] = useState(today());
  const [format, setFormat] = useState<{ prefix: string; length: number; running: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  // The parent re-mounts this dialog (key) each time it opens, so fields start fresh.
  useEffect(() => {
    if (!open) return;
    getCompany()
      .then((company) =>
        setFormat(
          company
            ? { prefix: company.lrPrefix || "", length: company.lrPrefixLength || 4, running: company.lrRunningNumber ?? 0 }
            : null
        )
      )
      .catch((error) => console.error(error));
  }, [open]);

  const digits = rawNumber.replace(/\D/g, "");
  const numeric = digits ? Number(digits) : 0;
  const formatted = format && numeric
    ? `${format.prefix}${String(numeric).padStart(Math.max(format.length, String(numeric).length), "0")}`
    : "";
  const currentLabel = format
    ? `${format.prefix}${String(format.running).padStart(Math.max(format.length, String(format.running).length), "0")}`
    : "";
  const error = !numeric
    ? null
    : format && numeric <= format.running
      ? `${formatted} is not a future number. The current sequence is at ${currentLabel}.`
      : null;

  async function handleReserve() {
    if (!numeric || error || !lrDate) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    try {
      setSaving(true);
      const reserved = await reserveLrNumber(numeric, lrDate);
      toast.success(`${reserved.lrNumber} reserved. It is saved as a draft; the normal sequence will skip it.`);
      onOpenChange(false);
      await onReserved();
    } catch (err) {
      console.error(err);
      toast.error(getUserFacingError(err, "Could not reserve this LR number. Nothing was saved."));
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !saving && onOpenChange(next)}
      title="Reserve future LR number"
      description="For the rare case where a future LR number was already given out (for example an advance to the driver). It is saved as a draft LR; the normal LR sequence continues as before and skips this number when it gets there."
      loading={saving}
      loadingText="Reserving..."
      footer={
        <>
          <Button variant="outline" onClick={() => (confirming ? setConfirming(false) : onOpenChange(false))} disabled={saving}>
            {confirming ? "Back" : "Cancel"}
          </Button>
          <Button onClick={handleReserve} disabled={saving || !numeric || Boolean(error) || !lrDate}>
            {confirming ? `Yes, reserve ${formatted}` : "Reserve"}
          </Button>
        </>
      }
    >
      {confirming ? (
        <div className="space-y-3 text-sm">
          <p>Reserve this LR number?</p>
          <p className="text-3xl font-bold tracking-wide">{formatted}</p>
          <p className="text-muted-foreground">
            LR date {lrDate}. The current sequence is at {currentLabel} and will continue from there.
            A reservation cannot be deleted; if it is not needed it can only be marked Cancelled.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="LR Number to reserve"
            htmlFor="reserve-lr-number"
            required
            error={error ?? undefined}
            hint={currentLabel ? `Must be above the current sequence (${currentLabel}). Digits only, e.g. 20200.` : undefined}
          >
            <Input
              id="reserve-lr-number"
              inputMode="numeric"
              placeholder="e.g. 20200"
              value={rawNumber}
              onChange={(e) => setRawNumber(e.target.value.replace(/\D/g, ""))}
            />
          </FormField>
          <FormDatePicker label="LR Date" id="reserve-lr-date" required value={lrDate} onChange={setLrDate} />
          {formatted && !error ? (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              Will be saved as <span className="font-semibold text-foreground">{formatted}</span> (draft).
            </p>
          ) : null}
        </div>
      )}
    </FormDialog>
  );
}
