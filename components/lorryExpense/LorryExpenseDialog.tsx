"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FormDialog from "@/components/ui/FormDialog";
import FormField from "@/components/ui/FormField";
import FormSection from "@/components/ui/FormSection";
import FormSelect from "@/components/ui/FormSelect";
import FormDatePicker from "@/components/ui/FormDatePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import BlankableNumberInput from "@/components/common/BlankableNumberInput";
import LRLookup from "@/components/lookup/LRLookup";
import {
  LORRY_EXPENSE_STATUS_SELECT_OPTIONS,
  LORRY_EXPENSE_TDS_PERCENTAGE_OPTIONS,
  validateLorryExpense,
  type FinancialsLrCommercial,
  type LorryExpense,
  type LorryExpenseStatus,
} from "./lorryExpense.schema";
import {
  getBeneficiaryNameSuggestions,
  getBrokerNameSuggestions,
  getLorryExpenseByLrId,
  type LorryExpenseRecord,
} from "@/components/services/lorryExpense.service";
import type { LRRecord } from "@/components/services/lr.service";
import {
  BILL_RATE_TYPE_OPTIONS,
  LORRY_HIRE_TYPE_OPTIONS,
  type BillRateType,
  type LorryHireType,
  type LR,
} from "@/components/lr/lr.schema";
import { calculateLR } from "@/lib/calculations/lrCalculations";
import {
  calculateFinancialProfitLoss,
  calculateLorrySettlement,
} from "@/lib/calculations/lorrySettlement";
import type { FieldErrors } from "@/lib/validation";
import { pickFields } from "@/lib/utils";
import { useDebouncedAutosave } from "@/hooks/useDebouncedAutosave";
import { isDraftEntry } from "@/lib/entryStatus";

interface LorryExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lorryExpense?: LorryExpenseRecord | null;
  lr?: LRRecord | null;
  loading?: boolean;
  readOnly?: boolean;
  onSubmit: (
    values: LorryExpense,
    existingId: number | null,
    commercial: FinancialsLrCommercial
  ) => void | Promise<void>;
  /** Draft autosave — expense row only; does not finalize or notify. */
  onAutosave?: (
    values: LorryExpense,
    existingId: number | null
  ) => void | Promise<number | null>;
}

const emptyExpense: LorryExpense = {
  lrId: 0,
  expenseStatus: "pending",
  entryStatus: "final",
  driverAdvance: 0,
  driverAdvance1Date: "",
  driverAdvance2: 0,
  driverAdvance2Date: "",
  dieselAdvance: 0,
  loadingCharges: 0,
  unloadingCharges: 0,
  detentionCharges: 0,
  hamali: 0,
  commission: 0,
  otherExpense: 0,
  brokerName: "",
  beneficiaryName: "",
  stChalan: 0,
  tdsPercentage: 0,
  otherDeduction: 0,
  finalAmountPaid: 0,
  balancePaidOn: "",
  remarks: "",
};

function toEditableExpense(record: LorryExpenseRecord): LorryExpense {
  return pickFields(record, Object.keys(emptyExpense) as (keyof LorryExpense)[]);
}

function money(value: number): string {
  return `₹ ${value.toFixed(2)}`;
}

function toOptions(values: readonly string[]) {
  return values.map((value) => ({ label: value, value }));
}

function hireTypeSelectOptions(current: string) {
  if ((LORRY_HIRE_TYPE_OPTIONS as readonly string[]).includes(current)) {
    return toOptions(LORRY_HIRE_TYPE_OPTIONS);
  }
  return toOptions([current, ...LORRY_HIRE_TYPE_OPTIONS]);
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value || "—"}</p>
    </div>
  );
}

function SuggestionInput({
  id,
  value,
  listId,
  suggestions,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  listId: string;
  suggestions: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <Input
        id={id}
        list={listId}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type or pick a suggestion"
        autoComplete="off"
      />
      <datalist id={listId}>
        {suggestions.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
    </>
  );
}

/**
 * Financials create/edit — billing & hire (saved on LR) plus expenses /
 * settlement (saved on lorry_expenses). Diesel Advance is not offered
 * for new entry; historical dieselAdvance is preserved on edit.
 */
export default function LorryExpenseDialog({
  open,
  onOpenChange,
  lorryExpense,
  lr,
  loading = false,
  readOnly = false,
  onSubmit,
  onAutosave,
}: LorryExpenseDialogProps) {
  const [values, setValues] = useState<LorryExpense>(emptyExpense);
  const [errors, setErrors] = useState<FieldErrors<LorryExpense>>({});
  const [commercialErrors, setCommercialErrors] = useState<Record<string, string>>({});
  const [selectedLR, setSelectedLR] = useState<LRRecord | null>(null);
  const [workingLr, setWorkingLr] = useState<LR | null>(null);
  const [existingId, setExistingId] = useState<number | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [brokerSuggestions, setBrokerSuggestions] = useState<string[]>([]);
  const [beneficiarySuggestions, setBeneficiarySuggestions] = useState<string[]>([]);
  const [draftHint, setDraftHint] = useState<string | null>(null);

  const isEditing = Boolean(lorryExpense);
  const lrLocked = isEditing;

  useDebouncedAutosave({
    values: { values, existingId },
    enabled:
      open &&
      !readOnly &&
      Boolean(onAutosave) &&
      !loading &&
      values.lrId > 0,
    delayMs: 2500,
    onSave: async ({ values: next, existingId: id }) => {
      if (!onAutosave) return;
      try {
        const savedId = await onAutosave(
          { ...next, entryStatus: "draft" },
          id
        );
        if (savedId && !id) setExistingId(savedId);
        setDraftHint("Draft saved");
      } catch {
        // Quiet — final Save still validates.
      }
    },
  });

  useEffect(() => {
    if (!open) return;

    setErrors({});
    setCommercialErrors({});
    setValues(lorryExpense ? { ...emptyExpense, ...toEditableExpense(lorryExpense) } : emptyExpense);
    setExistingId(lorryExpense?.id ?? null);
    setSelectedLR(lr ?? null);
    setWorkingLr(lr ? { ...lr } : null);
    setDraftHint(
      lorryExpense && isDraftEntry(lorryExpense.entryStatus)
        ? "Incomplete draft — continue editing, then Save."
        : null
    );

    Promise.all([getBrokerNameSuggestions(), getBeneficiaryNameSuggestions()])
      .then(([brokers, beneficiaries]) => {
        setBrokerSuggestions(brokers);
        setBeneficiarySuggestions(beneficiaries);
      })
      .catch((error) => console.error(error));
  }, [open, lorryExpense, lr]);

  async function handleSelectLR(next: LRRecord) {
    setSelectedLR(next);
    setWorkingLr({ ...next });
    setValues((prev) => ({ ...prev, lrId: next.id, dieselAdvance: 0 }));

    try {
      const existing = await getLorryExpenseByLrId(next.id);

      if (existing) {
        setValues(toEditableExpense(existing));
        setExistingId(existing.id);
        toast.info("This LR already has Financials — editing the existing record.");
      } else {
        setExistingId(null);
      }
    } catch (error) {
      console.error(error);
    }
  }

  const lrCalc = workingLr ? calculateLR(workingLr) : null;
  const settlement = calculateLorrySettlement({
    lorryHireAmount: lrCalc?.lorryHireAmount ?? 0,
    driverAdvance: values.driverAdvance,
    driverAdvance2: values.driverAdvance2,
    dieselAdvance: values.dieselAdvance,
    loadingCharges: values.loadingCharges,
    unloadingCharges: values.unloadingCharges,
    detentionCharges: values.detentionCharges,
    hamali: values.hamali,
    commission: values.commission,
    otherExpense: values.otherExpense,
    stChalan: values.stChalan,
    otherDeduction: values.otherDeduction,
    finalAmountPaid: values.finalAmountPaid,
    tdsPercentage: values.tdsPercentage,
  });
  const profitLoss = calculateFinancialProfitLoss(lrCalc?.billAmount ?? 0, settlement.totalExpenses);

  function updateExpense<K extends keyof LorryExpense>(key: K, value: LorryExpense[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function updateCommercial<K extends keyof LR>(key: K, value: LR[K]) {
    setWorkingLr((current) => (current ? { ...current, [key]: value } : current));
  }

  function handleSave() {
    if (!workingLr || !values.lrId) return;

    const fieldErrors = validateLorryExpense(values);
    const nextCommercialErrors: Record<string, string> = {};

    if (workingLr.billRateType === "Guaranteed Weight" && workingLr.guaranteedWeight <= 0) {
      nextCommercialErrors.guaranteedWeight =
        "Guaranteed weight is required when bill rate type is Guaranteed Weight.";
    }
    if (
      workingLr.lorryHireType === "Guaranteed Weight" &&
      workingLr.lorryHireGuaranteedWeight <= 0
    ) {
      nextCommercialErrors.lorryHireGuaranteedWeight =
        "Guaranteed weight is required when lorry hire type is Guaranteed Weight.";
    }

    if (Object.keys(fieldErrors).length > 0 || Object.keys(nextCommercialErrors).length > 0) {
      setErrors(fieldErrors);
      setCommercialErrors(nextCommercialErrors);
      return;
    }

    setErrors({});
    setCommercialErrors({});

    const commercial: FinancialsLrCommercial = {
      billRate: workingLr.billRate,
      billRateType: workingLr.billRateType,
      guaranteedWeight: workingLr.guaranteedWeight,
      lorryHireRate: workingLr.lorryHireRate,
      lorryHireType: workingLr.lorryHireType,
      lorryHireGuaranteedWeight: workingLr.lorryHireGuaranteedWeight,
    };

    // New entries never write diesel; edits preserve historical dieselAdvance.
    const payload: LorryExpense = {
      ...values,
      dieselAdvance: isEditing || existingId ? values.dieselAdvance : 0,
    };

    onSubmit(payload, existingId, commercial);
  }

  function handleClose() {
    onOpenChange(false);
  }

  const billPending = workingLr?.billRateType === "Per Ton (Unloading)";

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title={readOnly ? "View Financials" : isEditing || existingId ? "Edit Financials" : "Add Financials"}
        description="Billing, lorry hire, expenses and settlement for one LR."
        size="lg"
        loading={loading}
        loadingText="Saving Financials..."
        footer={
          readOnly ? (
            <Button onClick={handleClose}>Close</Button>
          ) : (
            <>
              {draftHint ? (
                <p className="mr-auto text-xs text-muted-foreground">{draftHint}</p>
              ) : null}
              <Button variant="outline" onClick={handleClose} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={loading || !values.lrId}>
                {loading ? "Saving..." : "Save Financials"}
              </Button>
            </>
          )
        }
      >
        <FormSection title="Linked LR">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField label="LR Number" htmlFor="fin-lr-number" required className="sm:col-span-2">
              <div className="flex gap-3">
                <Input
                  id="fin-lr-number"
                  readOnly
                  placeholder="Select an LR"
                  value={selectedLR?.lrNumber ?? ""}
                />
                {!readOnly && !lrLocked && (
                  <Button type="button" variant="outline" onClick={() => setLookupOpen(true)}>
                    Search
                  </Button>
                )}
              </div>
            </FormField>

            {selectedLR && workingLr && (
              <div className="grid grid-cols-1 gap-4 rounded-lg border bg-muted/30 p-4 sm:col-span-2 sm:grid-cols-3">
                <ReadOnlyField label="Consignor" value={selectedLR.consignor} />
                <ReadOnlyField label="Consignee" value={selectedLR.consignee} />
                <ReadOnlyField label="Vehicle Number" value={selectedLR.vehicleNumber} />
                <ReadOnlyField label="Driver Name" value={selectedLR.driverName} />
                <ReadOnlyField label="Loading Weight" value={String(workingLr.loadingWeight)} />
                <ReadOnlyField label="Unloading Weight" value={String(workingLr.unloadingWeight)} />
              </div>
            )}
          </div>
        </FormSection>

        <FormSection title="Expense Status">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormSelect
              label="Expense Status"
              id="fin-expense-status"
              required
              value={values.expenseStatus}
              onValueChange={(value) =>
                updateExpense("expenseStatus", value as LorryExpenseStatus)
              }
              disabled={readOnly}
              options={[...LORRY_EXPENSE_STATUS_SELECT_OPTIONS]}
              error={errors.expenseStatus}
              hint="Pending = saved but work is not finished. Completed = expense entry is finalized."
            />
          </div>
        </FormSection>

        {workingLr && (
          <>
            <FormSection title="Billing Details">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <FormField label="Bill Rate" htmlFor="fin-bill-rate">
                  <BlankableNumberInput
                    id="fin-bill-rate"
                    min={0}
                    readOnly={readOnly}
                    blankWhenZero={!isEditing}
                    value={workingLr.billRate}
                    onChange={(value) => updateCommercial("billRate", value)}
                  />
                </FormField>
                <FormSelect
                  label="Bill Rate Type"
                  id="fin-bill-rate-type"
                  value={workingLr.billRateType}
                  onValueChange={(value) =>
                    updateCommercial("billRateType", value as BillRateType)
                  }
                  disabled={readOnly}
                  options={toOptions(BILL_RATE_TYPE_OPTIONS)}
                />
                <FormField
                  label="Guaranteed Weight"
                  htmlFor="fin-guaranteed-weight"
                  error={commercialErrors.guaranteedWeight}
                >
                  <BlankableNumberInput
                    id="fin-guaranteed-weight"
                    min={0}
                    readOnly={readOnly}
                    blankWhenZero={!isEditing}
                    value={workingLr.guaranteedWeight}
                    onChange={(value) => updateCommercial("guaranteedWeight", value)}
                  />
                </FormField>
                <FormField label="Bill Amount" htmlFor="fin-bill-amount">
                  <Input
                    id="fin-bill-amount"
                    readOnly
                    value={
                      billPending
                        ? "Pending (after unloading weight)"
                        : (lrCalc?.billAmount ?? 0).toFixed(2)
                    }
                  />
                </FormField>
              </div>
            </FormSection>

            <FormSection title="Lorry Hire Details">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <FormField label="Hire Rate" htmlFor="fin-hire-rate">
                  <BlankableNumberInput
                    id="fin-hire-rate"
                    min={0}
                    readOnly={readOnly}
                    blankWhenZero={!isEditing}
                    value={workingLr.lorryHireRate}
                    onChange={(value) => updateCommercial("lorryHireRate", value)}
                  />
                </FormField>
                <FormSelect
                  label="Hire Type"
                  id="fin-hire-type"
                  value={workingLr.lorryHireType}
                  onValueChange={(value) =>
                    updateCommercial("lorryHireType", value as LorryHireType)
                  }
                  disabled={readOnly}
                  options={hireTypeSelectOptions(workingLr.lorryHireType)}
                />
                <FormField
                  label="Guaranteed Weight"
                  htmlFor="fin-hire-guaranteed-weight"
                  error={commercialErrors.lorryHireGuaranteedWeight}
                >
                  <BlankableNumberInput
                    id="fin-hire-guaranteed-weight"
                    min={0}
                    readOnly={readOnly}
                    blankWhenZero={!isEditing}
                    value={workingLr.lorryHireGuaranteedWeight}
                    onChange={(value) => updateCommercial("lorryHireGuaranteedWeight", value)}
                  />
                </FormField>
                <FormField label="Hire Amount" htmlFor="fin-hire-amount">
                  <Input
                    id="fin-hire-amount"
                    readOnly
                    value={(lrCalc?.lorryHireAmount ?? 0).toFixed(2)}
                  />
                </FormField>
              </div>
            </FormSection>

            <FormSection title="Expenses">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <FormField
                  label="Driver Advance 1"
                  htmlFor="fin-driver-advance"
                  error={errors.driverAdvance}
                >
                  <BlankableNumberInput
                    id="fin-driver-advance"
                    min={0}
                    readOnly={readOnly}
                    blankWhenZero={!isEditing}
                    value={values.driverAdvance}
                    onChange={(value) => updateExpense("driverAdvance", value)}
                  />
                </FormField>
                <FormDatePicker
                  label="Driver Advance 1 Date"
                  id="fin-driver-advance-1-date"
                  value={values.driverAdvance1Date}
                  onChange={(value) => updateExpense("driverAdvance1Date", value)}
                  disabled={readOnly}
                />
                <FormField
                  label="Driver Advance 2"
                  htmlFor="fin-driver-advance-2"
                  error={errors.driverAdvance2}
                >
                  <BlankableNumberInput
                    id="fin-driver-advance-2"
                    min={0}
                    readOnly={readOnly}
                    blankWhenZero={!isEditing}
                    value={values.driverAdvance2}
                    onChange={(value) => updateExpense("driverAdvance2", value)}
                  />
                </FormField>
                <FormDatePicker
                  label="Driver Advance 2 Date"
                  id="fin-driver-advance-2-date"
                  value={values.driverAdvance2Date}
                  onChange={(value) => updateExpense("driverAdvance2Date", value)}
                  disabled={readOnly}
                />
                <FormField
                  label="Loading Charges"
                  htmlFor="fin-loading-charges"
                  error={errors.loadingCharges}
                >
                  <BlankableNumberInput
                    id="fin-loading-charges"
                    min={0}
                    readOnly={readOnly}
                    blankWhenZero={!isEditing}
                    value={values.loadingCharges}
                    onChange={(value) => updateExpense("loadingCharges", value)}
                  />
                </FormField>
                <FormField
                  label="Unloading Charges"
                  htmlFor="fin-unloading-charges"
                  error={errors.unloadingCharges}
                >
                  <BlankableNumberInput
                    id="fin-unloading-charges"
                    min={0}
                    readOnly={readOnly}
                    blankWhenZero={!isEditing}
                    value={values.unloadingCharges}
                    onChange={(value) => updateExpense("unloadingCharges", value)}
                  />
                </FormField>
                <FormField
                  label="Detention Charges"
                  htmlFor="fin-detention-charges"
                  error={errors.detentionCharges}
                >
                  <BlankableNumberInput
                    id="fin-detention-charges"
                    min={0}
                    readOnly={readOnly}
                    blankWhenZero={!isEditing}
                    value={values.detentionCharges}
                    onChange={(value) => updateExpense("detentionCharges", value)}
                  />
                </FormField>
                <FormField label="Hamali" htmlFor="fin-hamali" error={errors.hamali}>
                  <BlankableNumberInput
                    id="fin-hamali"
                    min={0}
                    readOnly={readOnly}
                    blankWhenZero={!isEditing}
                    value={values.hamali}
                    onChange={(value) => updateExpense("hamali", value)}
                  />
                </FormField>
                <FormField label="Commission" htmlFor="fin-commission" error={errors.commission}>
                  <BlankableNumberInput
                    id="fin-commission"
                    min={0}
                    readOnly={readOnly}
                    blankWhenZero={!isEditing}
                    value={values.commission}
                    onChange={(value) => updateExpense("commission", value)}
                  />
                </FormField>
                <FormField
                  label="Other Expense"
                  htmlFor="fin-other-expense"
                  error={errors.otherExpense}
                >
                  <BlankableNumberInput
                    id="fin-other-expense"
                    min={0}
                    readOnly={readOnly}
                    blankWhenZero={!isEditing}
                    value={values.otherExpense}
                    onChange={(value) => updateExpense("otherExpense", value)}
                  />
                </FormField>
                <FormField label="Broker Name" htmlFor="fin-broker-name" error={errors.brokerName}>
                  <SuggestionInput
                    id="fin-broker-name"
                    listId="fin-broker-suggestions"
                    value={values.brokerName}
                    suggestions={brokerSuggestions}
                    disabled={readOnly}
                    onChange={(value) => updateExpense("brokerName", value)}
                  />
                </FormField>
                <FormField
                  label="Beneficiary Name"
                  htmlFor="fin-beneficiary-name"
                  error={errors.beneficiaryName}
                >
                  <SuggestionInput
                    id="fin-beneficiary-name"
                    listId="fin-beneficiary-suggestions"
                    value={values.beneficiaryName}
                    suggestions={beneficiarySuggestions}
                    disabled={readOnly}
                    onChange={(value) => updateExpense("beneficiaryName", value)}
                  />
                </FormField>
              </div>
            </FormSection>

            <FormSection title="Settlement">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <FormField label="ST Chalan" htmlFor="fin-st-chalan" error={errors.stChalan}>
                  <BlankableNumberInput
                    id="fin-st-chalan"
                    min={0}
                    readOnly={readOnly}
                    blankWhenZero={!isEditing}
                    value={values.stChalan}
                    onChange={(value) => updateExpense("stChalan", value)}
                  />
                </FormField>
                <FormSelect
                  label="TDS"
                  id="fin-tds"
                  value={String(values.tdsPercentage)}
                  onValueChange={(value) => updateExpense("tdsPercentage", Number(value))}
                  disabled={readOnly}
                  hint="1% of Lorry Hire Amount."
                  options={LORRY_EXPENSE_TDS_PERCENTAGE_OPTIONS.map((option) => ({
                    label: option === 0 ? "NIL" : "1%",
                    value: String(option),
                  }))}
                />
                <FormField
                  label="Any Other Deduction"
                  htmlFor="fin-other-deduction"
                  error={errors.otherDeduction}
                >
                  <BlankableNumberInput
                    id="fin-other-deduction"
                    min={0}
                    readOnly={readOnly}
                    blankWhenZero={!isEditing}
                    value={values.otherDeduction}
                    onChange={(value) => updateExpense("otherDeduction", value)}
                  />
                </FormField>
                <FormField
                  label="Final Amount Paid"
                  htmlFor="fin-final-amount-paid"
                  error={errors.finalAmountPaid}
                >
                  <BlankableNumberInput
                    id="fin-final-amount-paid"
                    min={0}
                    readOnly={readOnly}
                    blankWhenZero={!isEditing}
                    value={values.finalAmountPaid}
                    onChange={(value) => updateExpense("finalAmountPaid", value)}
                  />
                </FormField>
                <FormDatePicker
                  label="Balance Paid On"
                  id="fin-balance-paid-on"
                  value={values.balancePaidOn}
                  onChange={(value) => updateExpense("balancePaidOn", value)}
                  disabled={readOnly}
                />
              </div>
            </FormSection>

            <FormSection title="Remarks">
              <FormField label="Remarks / Notes" htmlFor="fin-remarks" error={errors.remarks}>
                <Textarea
                  id="fin-remarks"
                  rows={3}
                  disabled={readOnly}
                  value={values.remarks}
                  onChange={(e) => updateExpense("remarks", e.target.value)}
                  placeholder="Reference / audit notes (does not affect totals)"
                />
              </FormField>
            </FormSection>

            <div className="mt-2 grid grid-cols-2 gap-4 rounded-xl border border-orange-200/80 bg-card p-6 shadow-sm sm:grid-cols-3 lg:grid-cols-6">
              <div>
                <p className="text-xs text-muted-foreground">Bill Amount</p>
                <p className="text-lg font-semibold">{money(lrCalc?.billAmount ?? 0)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Lorry Hire Amount</p>
                <p className="text-lg font-semibold">{money(lrCalc?.lorryHireAmount ?? 0)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Expenses</p>
                <p className="text-lg font-semibold">{money(settlement.totalExpenses)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Balance Payable</p>
                <p className="text-lg font-semibold text-orange-700 dark:text-orange-400">
                  {money(settlement.balancePayable)}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs text-muted-foreground">Profit / Loss</p>
                <p
                  className={`text-lg font-semibold ${
                    profitLoss >= 0 ? "text-success" : "text-destructive"
                  }`}
                >
                  {money(profitLoss)}
                </p>
              </div>
            </div>
          </>
        )}
      </FormDialog>

      <LRLookup
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelect={(next) => {
          handleSelectLR(next);
          setLookupOpen(false);
        }}
      />
    </>
  );
}
