"use client";

import FormSelect from "@/components/ui/FormSelect";
import FormSection from "@/components/ui/FormSection";

import { FREIGHT_TYPE_OPTIONS, type LR } from "../lr.schema";
import type { FieldErrors } from "@/lib/validation";

interface CommercialSectionProps {
  lr: LR;
  errors?: FieldErrors<LR>;
  onChange: (lr: LR) => void;
}

function toOptions(values: readonly string[]) {
  return values.map((value) => ({ label: value, value }));
}

/**
 * LR Commercial Details — Freight Type only.
 * Billing and Lorry Hire rates are entered/edited in Financials and
 * remain stored on the LR (source of truth). Expense columns on `lrs`
 * are untouched for historical data.
 */
export default function CommercialSection({
  lr,
  errors = {},
  onChange,
}: CommercialSectionProps) {
  function update<K extends keyof LR>(key: K, value: LR[K]) {
    onChange({ ...lr, [key]: value });
  }

  return (
    <FormSection
      title="Commercial Details"
      subtitle="Freight type for this LR. Billing and lorry hire are managed in Financials."
    >
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
    </FormSection>
  );
}
