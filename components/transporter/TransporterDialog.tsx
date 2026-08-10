"use client";

import { useEffect, useState } from "react";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";
import TransporterForm from "./TransporterForm";
import {
  PAYMENT_MODE_OPTIONS,
  validateTransporter,
  type Transporter,
} from "./transporter.schema";
import type { FieldErrors } from "@/lib/validation";
import type { TransporterRecord } from "@/components/services/transporter.service";
import { pickFields } from "@/lib/utils";

interface TransporterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a record to edit; omit/null to add a new transporter. */
  transporter?: TransporterRecord | null;
  /** Shows the FormDialog's blocking "Saving..." overlay while a save is in flight. */
  loading?: boolean;
  onSubmit: (values: Transporter) => void | Promise<void>;
}

const emptyTransporter: Transporter = {
  code: "",
  transporterName: "",
  transporterType: "Fleet Owner",
  gstin: "",
  pan: "",

  contactPerson: "",
  mobile: "",
  alternateMobile: "",
  email: "",
  website: "",

  address: "",
  city: "",
  state: "",
  pincode: "",

  accountHolderName: "",
  bankName: "",
  accountNumber: "",
  ifsc: "",
  upiId: "",

  paymentTerm: "Immediate",
  creditDays: 0,
  creditLimit: 0,
  preferredPaymentMode: PAYMENT_MODE_OPTIONS[0],

  remarks: "",
  status: "Active",
};

/** Picks only the `Transporter` schema fields off a `TransporterRecord`,
 * dropping server-owned columns (`id`, `created_at`) so they never enter
 * editable form state — and therefore never reach `updateTransporter()`'s
 * payload. */
function toEditableTransporter(record: TransporterRecord): Transporter {
  return pickFields(record, Object.keys(emptyTransporter) as (keyof Transporter)[]);
}

export default function TransporterDialog({
  open,
  onOpenChange,
  transporter,
  loading = false,
  onSubmit,
}: TransporterDialogProps) {
  const [values, setValues] = useState<Transporter>(emptyTransporter);
  const [errors, setErrors] = useState<FieldErrors<Transporter>>({});

  const isEditing = Boolean(transporter);

  useEffect(() => {
    if (open) {
      setValues(
        transporter ? { ...emptyTransporter, ...toEditableTransporter(transporter) } : emptyTransporter
      );
      setErrors({});
    }
  }, [open, transporter]);

  function handleSave() {
    const fieldErrors = validateTransporter(values);

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
      title={isEditing ? "Edit Transporter" : "Add Transporter"}
      description={
        isEditing
          ? "Update the transporter details below."
          : "Enter the transporter details below."
      }
      size="xl"
      loading={loading}
      loadingText="Saving transporter..."
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
            {loading ? "Saving..." : "Save Transporter"}
          </Button>
        </>
      }
    >
      <TransporterForm
        transporter={values}
        errors={errors}
        onChange={setValues}
        isNew={!isEditing}
      />
    </FormDialog>
  );
}
