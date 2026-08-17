"use client";

import { useEffect, useState } from "react";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";
import BillingPartyForm from "./BillingPartyForm";
import { validateBillingParty, type BillingPartyMaster } from "./billingParty.schema";
import type { FieldErrors } from "@/lib/validation";
import type { BillingPartyRecord } from "@/components/services/billingParty.service";
import { pickFields } from "@/lib/utils";
import { useDebouncedAutosave } from "@/hooks/useDebouncedAutosave";

interface BillingPartyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  billingParty?: BillingPartyRecord | null;
  loading?: boolean;
  onSubmit: (values: BillingPartyMaster) => void | Promise<void>;
  onAutosave?: (values: BillingPartyMaster) => void | Promise<void>;
}

const emptyBillingParty: BillingPartyMaster = {
  code: "",
  name: "",
  gst: "",
  mobile: "",
  email: "",
  city: "",
  address: "",
  status: "Active",
  entryStatus: "final",
  poNumber: "",
  concernPerson: "",
  shortCode: "",
  paymentCycleDays: 0,
};

function toEditableBillingParty(record: BillingPartyRecord): BillingPartyMaster {
  return pickFields(record, Object.keys(emptyBillingParty) as (keyof BillingPartyMaster)[]);
}

export default function BillingPartyDialog({
  open,
  onOpenChange,
  billingParty,
  loading = false,
  onSubmit,
  onAutosave,
}: BillingPartyDialogProps) {
  const [values, setValues] = useState<BillingPartyMaster>(emptyBillingParty);
  const [errors, setErrors] = useState<FieldErrors<BillingPartyMaster>>({});
  const [draftHint, setDraftHint] = useState<string | null>(null);

  const isEditing = Boolean(billingParty);

  useEffect(() => {
    if (open) {
      setValues(
        billingParty
          ? { ...emptyBillingParty, ...toEditableBillingParty(billingParty) }
          : emptyBillingParty
      );
      setErrors({});
      setDraftHint(
        billingParty?.entryStatus === "draft"
          ? "Incomplete draft — continue editing, then Save."
          : null
      );
    }
  }, [open, billingParty]);

  useDebouncedAutosave({
    values,
    enabled: open && Boolean(onAutosave) && !loading && values.name.trim().length > 0,
    delayMs: 2000,
    onSave: async (next) => {
      if (!onAutosave) return;
      try {
        await onAutosave({ ...next, entryStatus: "draft" });
        setDraftHint("Draft saved");
      } catch {
        // Quiet — final Save still validates.
      }
    },
  });

  function handleSave() {
    const fieldErrors = validateBillingParty(values);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    onSubmit({ ...values, entryStatus: "final" });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "Edit Billing Party" : "Add Billing Party"}
      description={
        isEditing
          ? "Update the billing party details below."
          : "Enter details below. Progress autosaves as an Incomplete draft."
      }
      loading={loading}
      loadingText="Saving billing party..."
      footer={
        <>
          {draftHint ? (
            <p className="mr-auto text-xs text-muted-foreground">{draftHint}</p>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save Billing Party"}
          </Button>
        </>
      }
    >
      <BillingPartyForm billingParty={values} errors={errors} onChange={setValues} />
    </FormDialog>
  );
}
