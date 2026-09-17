"use client";

import { useEffect, useState } from "react";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";
import BidForm from "./BidForm";
import { validateBid, type Bid } from "./bid.schema";
import type { BidRecord } from "@/components/services/bid.service";
import type { BillingPartyRecord } from "@/components/services/billingParty.service";
import type { MaterialRecord } from "@/components/services/material.service";
import { pickFields } from "@/lib/utils";
import type { FieldErrors } from "@/lib/validation";

interface BidDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a record to edit; omit/null to add a new bid. */
  bid?: BidRecord | null;
  billingParties: BillingPartyRecord[];
  materials: MaterialRecord[];
  /** Shows the FormDialog's blocking "Saving..." overlay while a save is in flight. */
  loading?: boolean;
  /** View-only mode: hides Save and disables the form. */
  readOnly?: boolean;
  onSubmit: (values: Bid) => void | Promise<void>;
}

const emptyBid: Bid = {
  bidReference: "",
  billingPartyId: 0,
  consignorId: 0,
  consigneeId: 0,
  source: "Manual",
  status: "Draft",
  pickupLocation: "",
  dropoffLocation: "",
  distanceKm: 0,
  transitTime: "",
  materialDescription: "",
  materialId: 0,
  vehicleType: "",
  totalQuantityMT: 0,
  expectedLoadMT: 0,
  marketVehicleQuote: 0,
  marketVehicleCostBasis: "Per Trip",
  bidRateBasis: null,
  bidRate: 0,
  winningRate: null,
  winningRateBasis: null,
  postedAt: new Date().toISOString(),
  closesAt: "",
  lossReason: null,
  resultRemarks: "",
  notes: "",
};

/** Picks only the `Bid` schema fields off a `BidRecord`, dropping
 * server-owned columns (`id`, timestamps, snapshots) so they never enter
 * editable form state — and therefore never reach `updateBid()`'s payload. */
function toEditableBid(record: BidRecord): Bid {
  return pickFields(record, Object.keys(emptyBid) as (keyof Bid)[]);
}

export default function BidDialog({
  open,
  onOpenChange,
  bid,
  billingParties,
  materials,
  loading = false,
  readOnly = false,
  onSubmit,
}: BidDialogProps) {
  const [values, setValues] = useState<Bid>(emptyBid);
  const [errors, setErrors] = useState<FieldErrors<Bid>>({});

  const isEditing = Boolean(bid);

  useEffect(() => {
    if (open) {
      setValues(bid ? { ...emptyBid, ...toEditableBid(bid) } : emptyBid);
      setErrors({});
    }
  }, [open, bid]);

  async function handleSave() {
    const validation = validateBid(values);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;
    await onSubmit(values);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={readOnly ? "Bid Details" : isEditing ? "Edit Bid" : "New Bid"}
      description="Track a transport bid and its expected profitability."
      loading={loading}
      loadingText="Saving bid..."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <Button onClick={handleSave} disabled={loading}>
              Save Bid
            </Button>
          )}
        </>
      }
    >
      <BidForm
        key={`${open}-${bid?.id ?? "new"}-${bid?.updated_at ?? ""}`}
        bid={values}
        errors={errors}
        onChange={setValues}
        billingParties={billingParties}
        materials={materials}
        initialConsignorName={bid?.consignorName ?? ""}
        initialConsigneeName={bid?.consigneeName ?? ""}
        legacyMaterialName={bid?.materialName ?? ""}
        isNew={!isEditing}
        readOnly={readOnly}
      />
    </FormDialog>
  );
}
