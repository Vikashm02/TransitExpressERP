"use client";

import { useEffect, useState } from "react";

import FormDialog from "@/components/ui/FormDialog";
import FormField from "@/components/ui/FormField";
import FormDatePicker from "@/components/ui/FormDatePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import BlankableNumberInput from "@/components/common/BlankableNumberInput";
import LRLookup from "@/components/lookup/LRLookup";
import type { LRRecord } from "@/components/services/lr.service";
import type { DeliveryChallanRecord } from "@/components/services/deliveryChallan.service";
import { validateDeliveryChallan, type DeliveryChallan } from "./deliveryChallan.schema";
import type { FieldErrors } from "@/lib/validation";
import { pickFields } from "@/lib/utils";

export type DeliveryChallanDialogMode = "create" | "edit" | "view";

interface DeliveryChallanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: DeliveryChallanDialogMode;
  challan?: DeliveryChallanRecord | null;
  loading?: boolean;
  onSubmit: (values: DeliveryChallan) => void | Promise<void>;
}

const emptyState: DeliveryChallan = {
  lrNumber: "",
  lrDate: "",
  consignor: "",
  consignorAddress: "",
  consignorGst: "",
  consignee: "",
  consigneeAddress: "",
  consigneeGst: "",
  byName: "",
  poNumber: "",
  poDate: "",
  description: "",
  qty: 0,
  vehicleNumber: "",
  hsn: "",
};

function toEditable(record: DeliveryChallanRecord): DeliveryChallan {
  return pickFields(record, Object.keys(emptyState) as (keyof DeliveryChallan)[]);
}

/** Snapshot LR → Delivery Challan auto fields. QTY ← Loading Weight;
 * PO Number ← LR PO Number. Manual fields (By / PO Date / HSN) are left
 * untouched so independent DC edits are never wiped. */
function applyLrSnapshot(current: DeliveryChallan, lr: LRRecord): DeliveryChallan {
  return {
    ...current,
    lrNumber: lr.lrNumber,
    lrDate: lr.lrDate,
    consignor: lr.consignor,
    consignorAddress: lr.consignorAddress,
    consignorGst: lr.consignorGST,
    consignee: lr.consignee,
    consigneeAddress: lr.consigneeAddress,
    consigneeGst: lr.consigneeGST,
    description: lr.material,
    qty: lr.loadingWeight,
    vehicleNumber: lr.vehicleNumber,
    poNumber: lr.poNumber,
  };
}

export default function DeliveryChallanDialog({
  open,
  onOpenChange,
  mode,
  challan,
  loading = false,
  onSubmit,
}: DeliveryChallanDialogProps) {
  const [values, setValues] = useState<DeliveryChallan>(emptyState);
  const [errors, setErrors] = useState<FieldErrors<DeliveryChallan>>({});
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lrFetched, setLrFetched] = useState(false);

  const readOnly = mode === "view";
  const lrLocked = mode !== "create" || lrFetched;

  useEffect(() => {
    if (!open) return;

    setErrors({});

    if (challan) {
      setValues(toEditable(challan));
      setLrFetched(true);
    } else {
      setValues(emptyState);
      setLrFetched(false);
    }
  }, [open, challan]);

  function update<K extends keyof DeliveryChallan>(key: K, value: DeliveryChallan[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleSelectLR(lr: LRRecord) {
    setValues((current) => applyLrSnapshot(current, lr));
    setLrFetched(true);
    setLookupOpen(false);
  }

  function handleClearLR() {
    if (mode !== "create") return;
    setValues(emptyState);
    setLrFetched(false);
    setErrors({});
  }

  function handleSave() {
    const fieldErrors = validateDeliveryChallan(values);

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    onSubmit(values);
  }

  const title =
    mode === "create"
      ? "Create Delivery Challan"
      : mode === "edit"
        ? "Edit Delivery Challan"
        : "View Delivery Challan";

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        description="Select an LR to auto-fill party, material, vehicle, actual weight and PO Number. Enter By, PO Date and HSN."
        loading={loading}
        loadingText="Saving Delivery Challan..."
        footer={
          readOnly ? (
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={loading || (mode === "create" && !lrFetched)}
              >
                {loading ? "Saving..." : "Save Delivery Challan"}
              </Button>
            </>
          )
        }
      >
        <div className="space-y-6">
          <section className="space-y-4">
            <h3 className="text-sm font-semibold">LR Selection</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label="LR Number"
                htmlFor="dc-lr-number"
                required
                error={errors.lrNumber}
                hint={mode === "create" ? "Select an existing LR to auto-fill the challan." : undefined}
              >
                <div className="flex gap-2">
                  <Input
                    id="dc-lr-number"
                    readOnly
                    placeholder="Select LR"
                    value={values.lrNumber}
                  />
                  {mode === "create" && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setLookupOpen(true)}
                        disabled={loading}
                      >
                        Search
                      </Button>
                      {lrFetched && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={handleClearLR}
                          disabled={loading}
                        >
                          Clear
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </FormField>

              <FormField
                label="LR Date"
                htmlFor="dc-lr-date"
                hint="Auto-filled from LR"
              >
                <Input
                  id="dc-lr-date"
                  readOnly
                  value={values.lrDate}
                />
              </FormField>
            </div>
          </section>

          {lrLocked && (
            <>
              <section className="space-y-4">
                <h3 className="text-sm font-semibold">Dispatch From (auto-filled)</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    label="Consignor"
                    htmlFor="dc-consignor"
                  >
                    <Input
                      id="dc-consignor"
                      readOnly
                      value={values.consignor}
                    />
                  </FormField>
                  <FormField
                    label="Consignor GST"
                    htmlFor="dc-consignor-gst"
                  >
                    <Input
                      id="dc-consignor-gst"
                      readOnly
                      value={values.consignorGst}
                    />
                  </FormField>
                  <FormField
                    label="Consignor Address"
                    htmlFor="dc-consignor-address"
                    className="sm:col-span-2"
                  >
                    <Textarea
                      id="dc-consignor-address"
                      readOnly
                      value={values.consignorAddress}
                      rows={3}
                    />
                  </FormField>
                  <FormField
                    label="By"
                    htmlFor="dc-by"
                    required
                    error={errors.byName}
                    hint="Manual entry — prints under the consignor name"
                    className="sm:col-span-2"
                  >
                    <Input
                      id="dc-by"
                      readOnly={readOnly}
                      placeholder="e.g. TRANS-JIT EXPRESS"
                      value={values.byName}
                      onChange={(e) => update("byName", e.target.value)}
                    />
                  </FormField>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-semibold">Dispatch To (auto-filled)</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    label="Consignee"
                    htmlFor="dc-consignee"
                  >
                    <Input
                      id="dc-consignee"
                      readOnly
                      value={values.consignee}
                    />
                  </FormField>
                  <FormField
                    label="Consignee GST"
                    htmlFor="dc-consignee-gst"
                  >
                    <Input
                      id="dc-consignee-gst"
                      readOnly
                      value={values.consigneeGst}
                    />
                  </FormField>
                  <FormField
                    label="Consignee Address"
                    htmlFor="dc-consignee-address"
                    className="sm:col-span-2"
                  >
                    <Textarea
                      id="dc-consignee-address"
                      readOnly
                      value={values.consigneeAddress}
                      rows={3}
                    />
                  </FormField>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-semibold">Purchase Order (manual)</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    label="PO Number"
                    htmlFor="dc-po-number"
                    required
                    error={errors.poNumber}
                    hint="Auto-filled from LR"
                  >
                    <Input
                      id="dc-po-number"
                      readOnly={readOnly}
                      value={values.poNumber}
                      onChange={(e) => update("poNumber", e.target.value)}
                    />
                  </FormField>
                  <FormDatePicker
                    label="PO Date"
                    id="dc-po-date"
                    required
                    error={errors.poDate}
                    value={values.poDate}
                    onChange={(value) => update("poDate", value)}
                    disabled={readOnly}
                  />
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-semibold">Item details</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    label="Description"
                    htmlFor="dc-description"
                    hint="Auto-filled from LR material"
                    className="sm:col-span-2"
                  >
                    <Textarea
                      id="dc-description"
                      readOnly
                      value={values.description}
                      rows={2}
                    />
                  </FormField>
                  <FormField
                    label="QTY (Actual Weight)"
                    htmlFor="dc-qty"
                    hint="Auto-filled from LR Actual / Loading Weight"
                    error={errors.qty}
                  >
                    <BlankableNumberInput
                      id="dc-qty"
                      min={0}
                      readOnly
                      blankWhenZero={false}
                      value={values.qty}
                      onChange={() => undefined}
                    />
                  </FormField>
                  <FormField
                    label="Vehicle No"
                    htmlFor="dc-vehicle"
                    hint="Auto-filled from LR"
                  >
                    <Input
                      id="dc-vehicle"
                      readOnly
                      value={values.vehicleNumber}
                    />
                  </FormField>
                  <FormField
                    label="HSN"
                    htmlFor="dc-hsn"
                    required
                    error={errors.hsn}
                    hint="Manual entry"
                  >
                    <Input
                      id="dc-hsn"
                      readOnly={readOnly}
                      value={values.hsn}
                      onChange={(e) => update("hsn", e.target.value)}
                    />
                  </FormField>
                </div>
              </section>
            </>
          )}
        </div>
      </FormDialog>

      <LRLookup
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelect={handleSelectLR}
      />
    </>
  );
}
