"use client";

import { useEffect, useState } from "react";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";
import BillingPartyForm from "./BillingPartyForm";
import { validateBillingParty, type BillingPartyMaster } from "./billingParty.schema";
import type { FieldErrors } from "@/lib/validation";
import type { BillingPartyRecord } from "@/components/services/billingParty.service";
import { pickFields } from "@/lib/utils";

interface BillingPartyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a record to edit; omit/null to add a new billing party. */
  billingParty?: BillingPartyRecord | null;
  /** Shows the FormDialog's blocking "Saving..." overlay while a save is in flight. */
  loading?: boolean;
  onSubmit: (values: BillingPartyMaster) => void | Promise<void>;
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
  poNumber: "",
  concernPerson: "",
  shortCode: "",
  paymentCycleDays: 0,
};

/** Picks only the `BillingPartyMaster` schema fields off a `BillingPartyRecord`,
 * dropping server-owned columns (`id`, `created_at`) so they never enter
 * editable form state — and therefore never reach `updateBillingParty()`'s payload. */
function toEditableBillingParty(record: BillingPartyRecord): BillingPartyMaster {
  return pickFields(record, Object.keys(emptyBillingParty) as (keyof BillingPartyMaster)[]);
}

export default function BillingPartyDialog({
  open,
  onOpenChange,
  billingParty,
  loading = false,
  onSubmit,
}: BillingPartyDialogProps) {
  const [values, setValues] = useState<BillingPartyMaster>(emptyBillingParty);
  const [errors, setErrors] = useState<FieldErrors<BillingPartyMaster>>({});

  const isEditing = Boolean(billingParty);

  useEffect(() => {
    if (open) {
      setValues(
        billingParty
          ? { ...emptyBillingParty, ...toEditableBillingParty(billingParty) }
          : emptyBillingParty
      );
      setErrors({});
    }
  }, [open, billingParty]);

  function handleSave() {
    const fieldErrors = validateBillingParty(values);

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    onSubmit(values);
  }

  function handleCancel() {
    onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "Edit Billing Party" : "Add Billing Party"}
      description={
        isEditing
          ? "Update the billing party details below."
          : "Enter the billing party details below."
      }
      loading={loading}
      loadingText="Saving billing party..."
      footer={
        <>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={loading}
          >
            Cancel
          </Button>

          <Button
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? "Saving..." : "Save Billing Party"}
          </Button>
        </>
      }
    >
      <BillingPartyForm
        billingParty={values}
        errors={errors}
        onChange={setValues}
      />
    </FormDialog>
  );
}
