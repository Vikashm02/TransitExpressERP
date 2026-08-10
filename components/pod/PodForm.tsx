"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import FormField from "@/components/ui/FormField";
import FormSection from "@/components/ui/FormSection";
import FormSelect from "@/components/ui/FormSelect";
import FormDatePicker from "@/components/ui/FormDatePicker";
import BlankableNumberInput from "@/components/common/BlankableNumberInput";
import { TDS_PERCENTAGE_OPTIONS, type Pod } from "./pod.schema";
import type { LRRecord } from "@/components/services/lr.service";
import type { LorryExpenseRecord } from "@/components/services/lorryExpense.service";
import { calculateLR } from "@/lib/calculations/lrCalculations";
import { calculateLorrySettlement } from "@/lib/calculations/lorrySettlement";
import type { FieldErrors } from "@/lib/validation";

interface PodFormProps {
  pod: Pod;
  errors?: FieldErrors<Pod>;
  onChange: (pod: Pod) => void;
  /** The full LR matching `pod.lrNumber`, resolved by the caller — used
   * only to display read-only verification fields; never edited here. */
  selectedLR: LRRecord | null;
  /** The Lorry Expenses record (if any) already saved for `selectedLR` —
   * folded into the settlement preview below, never edited here. */
  lorryExpense?: LorryExpenseRecord | null;
  /** Mirrors BlankableNumberInput's `blankWhenZero` — true only for a
   * brand-new POD, so a fresh ST Chalan/Other Deduction field isn't
   * prefilled with "0". */
  blankWhenZero?: boolean;
  onSearchLR: () => void;
  onProofSelect: (file: File) => void;
  uploadingProof?: boolean;
  readOnly?: boolean;
}

function money(value: number): string {
  return `₹ ${value.toFixed(2)}`;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">
        {label}
      </p>
      <p className="text-sm text-foreground">
        {value || "—"}
      </p>
    </div>
  );
}

export default function PodForm({
  pod,
  errors = {},
  onChange,
  selectedLR,
  lorryExpense,
  blankWhenZero = true,
  onSearchLR,
  onProofSelect,
  uploadingProof = false,
  readOnly = false,
}: PodFormProps) {
  function update<K extends keyof Pod>(key: K, value: Pod[K]) {
    onChange({ ...pod, [key]: value });
  }

  const lorryHireAmount = selectedLR ? calculateLR(selectedLR).lorryHireAmount : 0;

  const settlement = calculateLorrySettlement({
    lorryHireAmount,
    driverAdvance: lorryExpense?.driverAdvance,
    dieselAdvance: lorryExpense?.dieselAdvance,
    loadingCharges: lorryExpense?.loadingCharges,
    unloadingCharges: lorryExpense?.unloadingCharges,
    hamali: lorryExpense?.hamali,
    commission: lorryExpense?.commission,
    otherExpense: lorryExpense?.otherExpense,
    stChalan: pod.stChalan,
    otherDeduction: pod.otherDeduction,
    tdsPercentage: pod.tdsPercentage,
  });

  return (
    <FormSection title="Proof of Delivery">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FormField
          label="LR Number"
          htmlFor="pod-lr-number"
          required
          error={errors.lrNumber}
          className="sm:col-span-2"
        >
          <div className="flex gap-3">
            <Input
              id="pod-lr-number"
              placeholder="Select an LR"
              value={pod.lrNumber}
              readOnly
            />
            <Button
              type="button"
              variant="outline"
              disabled={readOnly}
              onClick={onSearchLR}
            >
              Search
            </Button>
          </div>
        </FormField>

        {selectedLR && (
          <div className="grid grid-cols-1 gap-4 rounded-lg border bg-muted/30 p-4 sm:col-span-2 sm:grid-cols-3">
            <ReadOnlyField label="Consignor" value={selectedLR.consignor} />
            <ReadOnlyField label="Consignee" value={selectedLR.consignee} />
            <ReadOnlyField label="Vehicle Number" value={selectedLR.vehicleNumber} />
            <ReadOnlyField label="Driver Name" value={selectedLR.driverName} />
            <ReadOnlyField label="From" value={selectedLR.from} />
            <ReadOnlyField label="To" value={selectedLR.to} />
          </div>
        )}

        <FormDatePicker
          label="POD Date"
          id="pod-date"
          required
          error={errors.podDate}
          value={pod.podDate}
          onChange={(value) => update("podDate", value)}
          disabled={readOnly}
        />

        <FormField
          label="Unloading Weight"
          htmlFor="pod-unloading-weight"
          required
          error={errors.unloadingWeight}
        >
          <Input
            id="pod-unloading-weight"
            type="number"
            step="0.01"
            min={0}
            placeholder="0.00"
            value={pod.unloadingWeight || ""}
            onChange={(e) => update("unloadingWeight", Number(e.target.value))}
            disabled={readOnly}
          />
        </FormField>

        <FormDatePicker
          label="Unloading Date"
          id="pod-unloading-date"
          required
          error={errors.unloadingDate}
          value={pod.unloadingDate}
          onChange={(value) => update("unloadingDate", value)}
          disabled={readOnly}
        />

        <FormField
          label="Proof of POD"
          htmlFor="pod-proof-file"
          hint="PDF, JPG, JPEG or PNG."
          className="sm:col-span-2"
        >
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={readOnly || uploadingProof}
              onClick={() => document.getElementById("pod-proof-file")?.click()}
            >
              {uploadingProof ? "Uploading..." : pod.proofUrl ? "Replace file" : "Upload file"}
            </Button>

            {pod.proofUrl && (
              <a
                href={pod.proofUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary underline underline-offset-2"
              >
                View uploaded file
              </a>
            )}

            <input
              id="pod-proof-file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onProofSelect(file);
                e.target.value = "";
              }}
            />
          </div>
        </FormField>
      </div>

      {/* ================= LORRY SETTLEMENT ================= */}

      <div className="mt-8 space-y-4">
        <h3 className="text-base font-medium">Lorry Settlement</h3>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <FormField
            label="ST Chalan"
            htmlFor="pod-st-chalan"
            error={errors.stChalan}
          >
            <BlankableNumberInput
              id="pod-st-chalan"
              min={0}
              readOnly={readOnly}
              blankWhenZero={blankWhenZero}
              value={pod.stChalan}
              onChange={(value) => update("stChalan", value)}
            />
          </FormField>

          <FormSelect
            label="TDS"
            id="pod-tds"
            value={String(pod.tdsPercentage)}
            onValueChange={(value) => update("tdsPercentage", Number(value))}
            disabled={readOnly}
            hint="1% of the calculated Lorry Hire Amount."
            options={TDS_PERCENTAGE_OPTIONS.map((option) => ({
              label: option === 0 ? "NIL" : "1%",
              value: String(option),
            }))}
          />

          <FormField
            label="Any Other Deduction"
            htmlFor="pod-other-deduction"
            error={errors.otherDeduction}
          >
            <BlankableNumberInput
              id="pod-other-deduction"
              min={0}
              readOnly={readOnly}
              blankWhenZero={blankWhenZero}
              value={pod.otherDeduction}
              onChange={(value) => update("otherDeduction", value)}
            />
          </FormField>

          <FormDatePicker
            label="Balance Paid On"
            id="pod-balance-paid-on"
            value={pod.balancePaidOn}
            onChange={(value) => update("balancePaidOn", value)}
            disabled={readOnly}
          />
        </div>

        {selectedLR && (
          <div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Lorry Hire Amount</p>
              <p className="text-sm font-semibold">{money(lorryHireAmount)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Lorry Expenses</p>
              <p className="text-sm font-semibold">{money(settlement.totalExpenses)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Deductions</p>
              <p className="text-sm font-semibold">{money(settlement.totalDeductions)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Balance Payable</p>
              <p className="text-sm font-semibold text-success">{money(settlement.balancePayable)}</p>
            </div>
            {!lorryExpense && (
              <p className="col-span-2 text-xs text-muted-foreground sm:col-span-4">
                No Lorry Expenses recorded yet for this LR — Balance Payable currently reflects only ST
                Chalan/TDS/Other Deduction above.
              </p>
            )}
          </div>
        )}
      </div>
    </FormSection>
  );
}
