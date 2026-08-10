"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FormDialog from "@/components/ui/FormDialog";
import FormField from "@/components/ui/FormField";
import FormSection from "@/components/ui/FormSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import BlankableNumberInput from "@/components/common/BlankableNumberInput";
import LRLookup from "@/components/lookup/LRLookup";
import { validateLorryExpense, type LorryExpense } from "./lorryExpense.schema";
import {
  getLorryExpenseByLrId,
  type LorryExpenseRecord,
} from "@/components/services/lorryExpense.service";
import { getPods, type PodRecord } from "@/components/services/pod.service";
import type { LRRecord } from "@/components/services/lr.service";
import { calculateLR } from "@/lib/calculations/lrCalculations";
import { calculateLorrySettlement } from "@/lib/calculations/lorrySettlement";
import type { FieldErrors } from "@/lib/validation";
import { pickFields } from "@/lib/utils";

interface LorryExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a record to edit (LR is fixed); omit/null to add a new one. */
  lorryExpense?: LorryExpenseRecord | null;
  /** The LR matching `lorryExpense.lrId`, resolved by the caller (it
   * already has the full LR list loaded) — required when editing,
   * ignored when adding (the user picks one via the LR lookup instead). */
  lr?: LRRecord | null;
  loading?: boolean;
  readOnly?: boolean;
  /** `existingId` is set when the caller is editing, OR when the user
   * picked an LR during "Add" that already has a record — in both
   * cases the parent must UPDATE rather than INSERT. */
  onSubmit: (values: LorryExpense, existingId: number | null) => void | Promise<void>;
}

const emptyExpense: LorryExpense = {
  lrId: 0,
  driverAdvance: 0,
  dieselAdvance: 0,
  loadingCharges: 0,
  unloadingCharges: 0,
  hamali: 0,
  commission: 0,
  otherExpense: 0,
};

function toEditableExpense(record: LorryExpenseRecord): LorryExpense {
  return pickFields(record, Object.keys(emptyExpense) as (keyof LorryExpense)[]);
}

function money(value: number): string {
  return `₹ ${value.toFixed(2)}`;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value || "—"}</p>
    </div>
  );
}

/**
 * Create/Edit for the Lorry Expenses module — one record per LR (see
 * migration 017's unique `lr_id` constraint). The LR lookup here is
 * powered by the same `LRLookup` used elsewhere, so it already only
 * lists LRs visible to the current user via RLS (their own assigned
 * LRs, or every LR for an admin) — no extra filtering code needed.
 *
 * If the user picks an LR during "Add" that already has an expense
 * record, this dialog transparently switches into "editing that
 * record" instead of erroring on the DB's unique constraint.
 */
export default function LorryExpenseDialog({
  open,
  onOpenChange,
  lorryExpense,
  lr,
  loading = false,
  readOnly = false,
  onSubmit,
}: LorryExpenseDialogProps) {
  const [values, setValues] = useState<LorryExpense>(emptyExpense);
  const [errors, setErrors] = useState<FieldErrors<LorryExpense>>({});
  const [selectedLR, setSelectedLR] = useState<LRRecord | null>(null);
  const [existingId, setExistingId] = useState<number | null>(null);
  const [pods, setPods] = useState<PodRecord[]>([]);
  const [lookupOpen, setLookupOpen] = useState(false);

  const isEditing = Boolean(lorryExpense);
  const lrLocked = isEditing; // Add flow may still change LR via lookup; Edit flow keeps it fixed.

  useEffect(() => {
    if (!open) return;

    setErrors({});
    setValues(lorryExpense ? { ...emptyExpense, ...toEditableExpense(lorryExpense) } : emptyExpense);
    setExistingId(lorryExpense?.id ?? null);
    setSelectedLR(lr ?? null);

    getPods()
      .then(setPods)
      .catch((error) => console.error(error));
  }, [open, lorryExpense, lr]);

  async function handleSelectLR(lr: LRRecord) {
    setSelectedLR(lr);
    setValues((prev) => ({ ...prev, lrId: lr.id }));

    try {
      const existing = await getLorryExpenseByLrId(lr.id);

      if (existing) {
        setValues(toEditableExpense(existing));
        setExistingId(existing.id);
        toast.info(`This LR already has Lorry Expenses — editing the existing record.`);
      } else {
        setExistingId(null);
      }
    } catch (error) {
      console.error(error);
    }
  }

  const matchingPod = selectedLR ? pods.find((pod) => pod.lrNumber === selectedLR.lrNumber) ?? null : null;
  const lorryHireAmount = selectedLR ? calculateLR(selectedLR).lorryHireAmount : 0;

  const settlement = calculateLorrySettlement({
    lorryHireAmount,
    driverAdvance: values.driverAdvance,
    dieselAdvance: values.dieselAdvance,
    loadingCharges: values.loadingCharges,
    unloadingCharges: values.unloadingCharges,
    hamali: values.hamali,
    commission: values.commission,
    otherExpense: values.otherExpense,
    stChalan: matchingPod?.stChalan,
    otherDeduction: matchingPod?.otherDeduction,
    tdsPercentage: matchingPod?.tdsPercentage,
  });

  function update<K extends keyof LorryExpense>(key: K, value: LorryExpense[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleSave() {
    const fieldErrors = validateLorryExpense(values);

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    onSubmit(values, existingId);
  }

  function handleClose() {
    onOpenChange(false);
  }

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title={readOnly ? "View Lorry Expenses" : isEditing || existingId ? "Edit Lorry Expenses" : "Add Lorry Expenses"}
        description="Driver/Diesel Advance, Loading/Unloading, Hamali, Commission and Other Expense for one LR."
        size="lg"
        loading={loading}
        loadingText="Saving Lorry Expenses..."
        footer={
          readOnly ? (
            <Button onClick={handleClose}>Close</Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={loading || !values.lrId}
              >
                {loading ? "Saving..." : "Save Lorry Expenses"}
              </Button>
            </>
          )
        }
      >
        <FormSection title="Linked LR">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField
              label="LR Number"
              htmlFor="le-lr-number"
              required
              className="sm:col-span-2"
            >
              <div className="flex gap-3">
                <Input
                  id="le-lr-number"
                  readOnly
                  placeholder="Select an LR"
                  value={selectedLR?.lrNumber ?? ""}
                />
                {!readOnly && !lrLocked && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setLookupOpen(true)}
                  >
                    Search
                  </Button>
                )}
              </div>
            </FormField>

            {selectedLR && (
              <div className="grid grid-cols-1 gap-4 rounded-lg border bg-muted/30 p-4 sm:col-span-2 sm:grid-cols-3">
                <ReadOnlyField label="Consignor" value={selectedLR.consignor} />
                <ReadOnlyField label="Consignee" value={selectedLR.consignee} />
                <ReadOnlyField label="Vehicle Number" value={selectedLR.vehicleNumber} />
                <ReadOnlyField label="Driver Name" value={selectedLR.driverName} />
                <ReadOnlyField label="Lorry Hire Type" value={selectedLR.lorryHireType} />
                <ReadOnlyField label="Lorry Hire Amount" value={money(lorryHireAmount)} />
              </div>
            )}
          </div>
        </FormSection>

        <FormSection title="Expenses">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <FormField
              label="Driver Advance"
              htmlFor="le-driver-advance"
              error={errors.driverAdvance}
            >
              <BlankableNumberInput
                id="le-driver-advance"
                min={0}
                readOnly={readOnly}
                blankWhenZero={!isEditing}
                value={values.driverAdvance}
                onChange={(value) => update("driverAdvance", value)}
              />
            </FormField>

            <FormField
              label="Diesel Advance"
              htmlFor="le-diesel-advance"
              error={errors.dieselAdvance}
            >
              <BlankableNumberInput
                id="le-diesel-advance"
                min={0}
                readOnly={readOnly}
                blankWhenZero={!isEditing}
                value={values.dieselAdvance}
                onChange={(value) => update("dieselAdvance", value)}
              />
            </FormField>

            <FormField
              label="Loading Charges"
              htmlFor="le-loading-charges"
              error={errors.loadingCharges}
            >
              <BlankableNumberInput
                id="le-loading-charges"
                min={0}
                readOnly={readOnly}
                blankWhenZero={!isEditing}
                value={values.loadingCharges}
                onChange={(value) => update("loadingCharges", value)}
              />
            </FormField>

            <FormField
              label="Unloading Charges"
              htmlFor="le-unloading-charges"
              error={errors.unloadingCharges}
            >
              <BlankableNumberInput
                id="le-unloading-charges"
                min={0}
                readOnly={readOnly}
                blankWhenZero={!isEditing}
                value={values.unloadingCharges}
                onChange={(value) => update("unloadingCharges", value)}
              />
            </FormField>

            <FormField
              label="Hamali"
              htmlFor="le-hamali"
              error={errors.hamali}
            >
              <BlankableNumberInput
                id="le-hamali"
                min={0}
                readOnly={readOnly}
                blankWhenZero={!isEditing}
                value={values.hamali}
                onChange={(value) => update("hamali", value)}
              />
            </FormField>

            <FormField
              label="Commission"
              htmlFor="le-commission"
              error={errors.commission}
            >
              <BlankableNumberInput
                id="le-commission"
                min={0}
                readOnly={readOnly}
                blankWhenZero={!isEditing}
                value={values.commission}
                onChange={(value) => update("commission", value)}
              />
            </FormField>

            <FormField
              label="Other Expense"
              htmlFor="le-other-expense"
              error={errors.otherExpense}
            >
              <BlankableNumberInput
                id="le-other-expense"
                min={0}
                readOnly={readOnly}
                blankWhenZero={!isEditing}
                value={values.otherExpense}
                onChange={(value) => update("otherExpense", value)}
              />
            </FormField>
          </div>
        </FormSection>

        {selectedLR && (
          <div className="mt-2 grid grid-cols-2 gap-4 rounded-xl border bg-card p-6 shadow-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Lorry Hire Amount</p>
              <p className="text-lg font-semibold">{money(lorryHireAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Expenses</p>
              <p className="text-lg font-semibold">{money(settlement.totalExpenses)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                POD Deductions {matchingPod ? "" : "(none recorded yet)"}
              </p>
              <p className="text-lg font-semibold">
                {money(settlement.totalDeductions - settlement.totalExpenses)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Balance Payable</p>
              <p className="text-lg font-semibold text-success">{money(settlement.balancePayable)}</p>
            </div>
          </div>
        )}
      </FormDialog>

      <LRLookup
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelect={(lr) => {
          handleSelectLR(lr);
          setLookupOpen(false);
        }}
      />
    </>
  );
}
