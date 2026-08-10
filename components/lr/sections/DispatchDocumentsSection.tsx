"use client";

import { Input } from "@/components/ui/input";
import FormField from "@/components/ui/FormField";
import FormDatePicker from "@/components/ui/FormDatePicker";
import FormSection from "@/components/ui/FormSection";

import LRNumericInput from "../LRNumericInput";
import type { LR } from "../lr.schema";
import type { FieldErrors } from "@/lib/validation";

interface DispatchDocumentsSectionProps {
  lr: LR;
  errors?: FieldErrors<LR>;
  onChange: (lr: LR) => void;
}

export default function DispatchDocumentsSection({
  lr,
  errors = {},
  onChange,
}: DispatchDocumentsSectionProps) {
  function update<K extends keyof LR>(key: K, value: LR[K]) {
    onChange({ ...lr, [key]: value });
  }

  return (
    <FormSection
      title="Dispatch Documents"
      subtitle="Customer reference documents"
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        <FormField
          label="PO Number"
          htmlFor="lr-po-number"
        >
          <Input
            id="lr-po-number"
            placeholder="PO Number"
            value={lr.poNumber}
            onChange={(e) => update("poNumber", e.target.value)}
          />
        </FormField>

        <FormField
          label="Vendor Code"
          htmlFor="lr-vendor-code"
        >
          <Input
            id="lr-vendor-code"
            placeholder="Vendor Code"
            value={lr.vendorCode}
            onChange={(e) => update("vendorCode", e.target.value)}
          />
        </FormField>

        <FormField
          label="DC Number / Invoice Number"
          htmlFor="lr-dc-number"
        >
          <Input
            id="lr-dc-number"
            placeholder="DC Number or Invoice Number"
            value={lr.dcNumber}
            onChange={(e) =>
              onChange({
                ...lr,
                dcNumber: e.target.value,
                invoiceNumber: e.target.value,
              })
            }
          />
        </FormField>

        <FormDatePicker
          label="DC Date / Invoice Date"
          id="lr-dc-date"
          value={lr.dcDate}
          onChange={(value) =>
            onChange({
              ...lr,
              dcDate: value,
              invoiceDate: value,
            })
          }
        />

        <FormField
          label="Invoice Value"
          htmlFor="lr-invoice-value"
          error={errors.invoiceValue}
        >
          <LRNumericInput
            id="lr-invoice-value"
            value={lr.invoiceValue}
            onChange={(value) => update("invoiceValue", value)}
          />
        </FormField>

        <FormField
          label="E-Way Bill Number"
          htmlFor="lr-eway-bill-number"
        >
          <Input
            id="lr-eway-bill-number"
            placeholder="E-Way Bill Number"
            value={lr.ewayBillNumber}
            onChange={(e) => update("ewayBillNumber", e.target.value)}
          />
        </FormField>
      </div>
    </FormSection>
  );
}
