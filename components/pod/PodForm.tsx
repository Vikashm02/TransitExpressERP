"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import FormField from "@/components/ui/FormField";
import FormSection from "@/components/ui/FormSection";
import FormDatePicker from "@/components/ui/FormDatePicker";
import type { Pod } from "./pod.schema";
import type { LRRecord } from "@/components/services/lr.service";
import type { FieldErrors } from "@/lib/validation";

interface PodFormProps {
  pod: Pod;
  errors?: FieldErrors<Pod>;
  onChange: (pod: Pod) => void;
  /** The full LR matching `pod.lrNumber`, resolved by the caller — used
   * only to display read-only verification fields; never edited here. */
  selectedLR: LRRecord | null;
  onSearchLR: () => void;
  onProofSelect: (file: File) => void;
  uploadingProof?: boolean;
  readOnly?: boolean;
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

/**
 * Proof of Delivery form. Lorry Settlement entry moved to Lorry Expenses;
 * POD settlement columns remain in the schema/DB for historical data and
 * are preserved on save via PodDialog state (not shown here).
 */
export default function PodForm({
  pod,
  errors = {},
  onChange,
  selectedLR,
  onSearchLR,
  onProofSelect,
  uploadingProof = false,
  readOnly = false,
}: PodFormProps) {
  function update<K extends keyof Pod>(key: K, value: Pod[K]) {
    onChange({ ...pod, [key]: value });
  }

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
    </FormSection>
  );
}
