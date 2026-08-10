"use client";

import { useEffect, useState } from "react";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";
import LRForm from "./LRForm";
import { validateLR, type LR } from "./lr.schema";
import type { FieldErrors } from "@/lib/validation";
import type { LRRecord } from "@/components/services/lr.service";
import { getCompany } from "@/components/services/company.service";
import { pickFields } from "@/lib/utils";

interface LRDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a record to edit; omit/null to add a new LR. */
  lr?: LRRecord | null;
  /** Shows the FormDialog's blocking "Saving..." overlay while a save is in flight. */
  loading?: boolean;
  onSubmit: (values: LR) => void | Promise<void>;
}

const emptyLR: LR = {
  // LR Information
  lrNumber: "",
  lrDate: "",
  bookingBranch: "",
  customer: "",
  billingParty: "Consignor",

  // Consignor
  consignor: "",
  consignorGST: "",
  consignorAddress: "",

  // Consignee
  consignee: "",
  consigneeGST: "",
  consigneeAddress: "",

  // Vehicle & Route
  vehicleNumber: "",
  vehicleType: "",
  transporter: "",
  driverName: "",
  driverMobile: "",
  from: "",
  to: "",

  // Material
  material: "",
  packageType: "",
  packages: 0,
  loadingWeight: 0,
  unloadingWeight: 0,
  chargedWeight: 0,

  // Dispatch Documents
  poNumber: "",
  vendorCode: "",
  dcNumber: "",
  dcDate: "",
  invoiceNumber: "",
  invoiceDate: "",
  invoiceValue: 0,
  ewayBillNumber: "",

  // Commercial
  billRate: 0,
  billRateType: "Fixed",
  guaranteedWeight: 0,
  lorryHireRate: 0,
  lorryHireType: "Fixed",
  lorryHireGuaranteedWeight: 0,
  freightType: "To Be Billed",

  driverAdvance: 0,
  dieselAdvance: 0,
  stChallan: 0,
  loadingCharges: 0,
  unloadingCharges: 0,
  hamali: 0,
  commission: 0,
  otherExpense: 0,

  // Remarks
  remarks: "",
  internalRemarks: "",

  // Status
  status: "Open",
};

/** Picks only the `LR` schema fields off an `LRRecord`, dropping
 * server-owned columns (`id`, `created_at`) and the computed commercial
 * columns (`billAmount`, `lorryHireAmount`, `profitAmount` — always
 * recomputed from `calculateLR()` at save time, never edited directly) so
 * none of them enter editable form state or `updateLR()`'s payload. */
function toEditableLR(record: LRRecord): LR {
  return pickFields(record, Object.keys(emptyLR) as (keyof LR)[]);
}

export default function LRDialog({
  open,
  onOpenChange,
  lr,
  loading = false,
  onSubmit,
}: LRDialogProps) {
  const [values, setValues] = useState<LR>(emptyLR);
  const [errors, setErrors] = useState<FieldErrors<LR>>({});

  const isEditing = Boolean(lr);

  useEffect(() => {
    if (!open) return;

    setErrors({});

    if (lr) {
      setValues({ ...emptyLR, ...toEditableLR(lr) });
      return;
    }

    // New LR: default Freight Type from Company Settings, falling back to
    // the module's historical default when Company Master isn't configured
    // yet. The user can still change it before saving.
    setValues(emptyLR);

    let cancelled = false;

    getCompany()
      .then((company) => {
        if (!cancelled && company?.defaultFreightType) {
          setValues((current) => ({ ...current, freightType: company.defaultFreightType }));
        }
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      cancelled = true;
    };
  }, [open, lr]);

  function handleSave() {
    const fieldErrors = validateLR(values);

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
      title={isEditing ? "Edit Lorry Receipt" : "Create Lorry Receipt"}
      description="Enter shipment, vehicle and commercial details."
      size="fullscreen"
      loading={loading}
      loadingText="Saving Lorry Receipt..."
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
            {loading ? "Saving..." : "Save LR"}
          </Button>
        </>
      }
    >
      <LRForm
        lr={values}
        errors={errors}
        onChange={setValues}
      />
    </FormDialog>
  );
}
