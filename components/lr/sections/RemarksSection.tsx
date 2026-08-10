"use client";

import { Textarea } from "@/components/ui/textarea";
import FormField from "@/components/ui/FormField";
import FormSection from "@/components/ui/FormSection";

import type { LR } from "../lr.schema";
import type { FieldErrors } from "@/lib/validation";

interface RemarksSectionProps {
  lr: LR;
  errors?: FieldErrors<LR>;
  onChange: (lr: LR) => void;
}

/**
 * Status is intentionally not editable here — it is workflow-controlled
 * (New LR -> Open, POD saved -> Delivered, Billing -> Billed, etc.), not a
 * manual field on LR Entry. The `status` value itself is untouched and
 * still displayed elsewhere (LR list, filters, print/share).
 */
export default function RemarksSection({
  lr,
  onChange,
}: RemarksSectionProps) {
  function update<K extends keyof LR>(key: K, value: LR[K]) {
    onChange({ ...lr, [key]: value });
  }

  return (
    <FormSection title="Remarks">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <FormField
          label="Remarks"
          htmlFor="lr-remarks"
        >
          <Textarea
            id="lr-remarks"
            placeholder="Remarks"
            value={lr.remarks}
            onChange={(e) => update("remarks", e.target.value)}
          />
        </FormField>

        <FormField
          label="Internal Remarks"
          htmlFor="lr-internal-remarks"
          className="md:col-span-2"
        >
          <Textarea
            id="lr-internal-remarks"
            placeholder="Internal Remarks"
            value={lr.internalRemarks}
            onChange={(e) => update("internalRemarks", e.target.value)}
          />
        </FormField>
      </div>
    </FormSection>
  );
}
