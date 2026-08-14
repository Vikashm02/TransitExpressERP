"use client";

import { Input } from "@/components/ui/input";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";
import FormSection from "@/components/ui/FormSection";

import { calculateLR } from "@/lib/calculations/lrCalculations";
import LRNumericInput from "../LRNumericInput";
import {
  BILL_RATE_TYPE_OPTIONS,
  FREIGHT_TYPE_OPTIONS,
  LORRY_HIRE_TYPE_OPTIONS,
  type LR,
} from "../lr.schema";
import type { FieldErrors } from "@/lib/validation";

interface CommercialSectionProps {
  lr: LR;
  errors?: FieldErrors<LR>;
  onChange: (lr: LR) => void;
}

function toOptions(values: readonly string[]) {
  return values.map((value) => ({ label: value, value }));
}

/** Hire Type dropdown options; keep a legacy stored value visible on edit. */
function hireTypeSelectOptions(current: LR["lorryHireType"]) {
  if ((LORRY_HIRE_TYPE_OPTIONS as readonly string[]).includes(current)) {
    return toOptions(LORRY_HIRE_TYPE_OPTIONS);
  }
  return toOptions([current, ...LORRY_HIRE_TYPE_OPTIONS]);
}

/** True only for the one rate type whose amount depends on POD Unloading
 * Weight, which isn't known/entered at LR-creation time. Every other Bill
 * Rate Type (Fixed, Per Ton (Loading), Guaranteed Weight) and every Lorry
 * Hire Type is fully computable from fields already on this form. */
function isBillAmountPending(lr: LR): boolean {
  return lr.billRateType === "Per Ton (Unloading)";
}

/**
 * Captures the rates needed by later Billing/Reports, plus the Bill
 * Rate / Lorry Hire totals that are actually knowable at LR-creation
 * time. Profit/Loss is intentionally NOT shown here — it also depends
 * on Bill Amount, which itself may be pending (Per Ton (Unloading)) —
 * that full summary still belongs to the later Billing/Reports stage.
 * `calculateLR()` continues to be the single source of truth and is
 * still (re)computed/stored at save time (see lr.service.ts).
 *
 * Expenses (Driver/Diesel Advance, Loading/Unloading Charges, Hamali,
 * Commission, Other Expense) are NOT entered here anymore — they now
 * live in the separate Lorry Expenses module (components/lorryExpense)
 * and are no longer subtracted from LR profit (see lrCalculations.ts).
 * The underlying `lr.schema.ts` fields and `lrs` table columns are
 * untouched so pre-existing LRs keep their historical values.
 */
export default function CommercialSection({
  lr,
  errors = {},
  onChange,
}: CommercialSectionProps) {
  const calc = calculateLR(lr);

  function update<K extends keyof LR>(key: K, value: LR[K]) {
    onChange({ ...lr, [key]: value });
  }

  return (
    <FormSection
      title="Commercial Details"
      subtitle="Billing and lorry hire rates. Expenses are tracked separately in the Lorry Expenses module."
    >
      <div className="space-y-8">
        {/* ================= BILLING ================= */}

        <div className="space-y-4">
          <h3 className="text-base font-medium">
            Billing
          </h3>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <FormField
              label="Bill Rate"
              htmlFor="lr-bill-rate"
              required
              error={errors.billRate}
            >
              <LRNumericInput
                id="lr-bill-rate"
                value={lr.billRate}
                onChange={(value) => update("billRate", value)}
              />
            </FormField>

            <FormSelect
              label="Bill Rate Type"
              id="lr-bill-rate-type"
              required
              error={errors.billRateType}
              value={lr.billRateType}
              onValueChange={(value) => update("billRateType", value as LR["billRateType"])}
              options={toOptions(BILL_RATE_TYPE_OPTIONS)}
            />

            <FormField
              label="Guaranteed Weight"
              htmlFor="lr-guaranteed-weight"
              error={errors.guaranteedWeight}
            >
              <LRNumericInput
                id="lr-guaranteed-weight"
                value={lr.guaranteedWeight}
                onChange={(value) => update("guaranteedWeight", value)}
              />
            </FormField>

            <FormField
              label="Bill Amount"
              htmlFor="lr-bill-amount"
            >
              <Input
                id="lr-bill-amount"
                readOnly
                value={isBillAmountPending(lr) ? "Pending (after POD)" : calc.billAmount.toFixed(2)}
              />
            </FormField>
          </div>
        </div>

        {/* ================= LORRY HIRE ================= */}

        <div className="space-y-4">
          <h3 className="text-base font-medium">
            Lorry Hire
          </h3>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <FormField
              label="Hire Rate"
              htmlFor="lr-lorry-hire-rate"
              required
              error={errors.lorryHireRate}
            >
              <LRNumericInput
                id="lr-lorry-hire-rate"
                value={lr.lorryHireRate}
                onChange={(value) => update("lorryHireRate", value)}
              />
            </FormField>

            <FormSelect
              label="Hire Type"
              id="lr-lorry-hire-type"
              required
              error={errors.lorryHireType}
              value={lr.lorryHireType}
              onValueChange={(value) => update("lorryHireType", value as LR["lorryHireType"])}
              options={hireTypeSelectOptions(lr.lorryHireType)}
            />

            <FormField
              label="Guaranteed Weight"
              htmlFor="lr-lorry-hire-guaranteed-weight"
              error={errors.lorryHireGuaranteedWeight}
            >
              <LRNumericInput
                id="lr-lorry-hire-guaranteed-weight"
                value={lr.lorryHireGuaranteedWeight}
                onChange={(value) => update("lorryHireGuaranteedWeight", value)}
              />
            </FormField>

            <FormField
              label="Hire Amount"
              htmlFor="lr-lorry-hire-amount"
            >
              <Input
                id="lr-lorry-hire-amount"
                readOnly
                value={calc.lorryHireAmount.toFixed(2)}
              />
            </FormField>
          </div>
        </div>

        {/* ================= FREIGHT ================= */}

        <div className="space-y-4">
          <h3 className="text-base font-medium">
            Freight
          </h3>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FormSelect
              label="Freight Type"
              id="lr-freight-type"
              required
              error={errors.freightType}
              value={lr.freightType}
              onValueChange={(value) => update("freightType", value as LR["freightType"])}
              options={toOptions(FREIGHT_TYPE_OPTIONS)}
            />
          </div>
        </div>
      </div>
    </FormSection>
  );
}
