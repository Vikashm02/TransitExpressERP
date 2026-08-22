"use client";

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import FormField from "@/components/ui/FormField";
import FormDatePicker from "@/components/ui/FormDatePicker";
import FormSection from "@/components/ui/FormSection";

import LRNumericInput from "../LRNumericInput";
import type { LR } from "../lr.schema";
import type { FieldErrors } from "@/lib/validation";
import {
  findLrsByDcNumberAndDate,
  type LRRecord,
} from "@/components/services/lr.service";

interface DispatchDocumentsSectionProps {
  lr: LR;
  errors?: FieldErrors<LR>;
  onChange: (lr: LR) => void;
  /** When editing, exclude this LR so it does not match itself. */
  excludeLrId?: LRRecord["id"] | null;
}

function formatDuplicateWarning(lrNumbers: string[]): string {
  if (lrNumbers.length === 0) return "";
  if (lrNumbers.length === 1) {
    return `⚠️ This LR could be a duplicate. It matches ${lrNumbers[0]}.`;
  }
  if (lrNumbers.length === 2) {
    return `⚠️ This LR could be a duplicate. It matches ${lrNumbers[0]} and ${lrNumbers[1]}.`;
  }
  const head = lrNumbers.slice(0, -1).join(", ");
  const last = lrNumbers[lrNumbers.length - 1];
  return `⚠️ This LR could be a duplicate. It matches ${head}, and ${last}.`;
}

export default function DispatchDocumentsSection({
  lr,
  errors = {},
  onChange,
  excludeLrId = null,
}: DispatchDocumentsSectionProps) {
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  function update<K extends keyof LR>(key: K, value: LR[K]) {
    onChange({ ...lr, [key]: value });
  }

  useEffect(() => {
    const dcNumber = (lr.dcNumber || "").trim();
    const dcDate = (lr.dcDate || "").trim();

    if (!dcNumber || !dcDate) {
      setDuplicateWarning(null);
      return;
    }

    let cancelled = false;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const matches = await findLrsByDcNumberAndDate({
            dcNumber,
            dcDate,
            excludeId: excludeLrId,
          });
          if (cancelled) return;
          const numbers = matches.map((m) => m.lrNumber);
          setDuplicateWarning(numbers.length ? formatDuplicateWarning(numbers) : null);
        } catch (error) {
          console.error(error);
          if (!cancelled) setDuplicateWarning(null);
        }
      })();
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [lr.dcNumber, lr.dcDate, excludeLrId]);

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

        {duplicateWarning ? (
          <p
            role="status"
            className="md:col-span-2 xl:col-span-3 rounded-md border border-warning/30 bg-warning/15 px-3 py-2 text-sm text-foreground"
          >
            {duplicateWarning}
          </p>
        ) : null}

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
