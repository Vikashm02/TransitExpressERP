"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import FormField from "@/components/ui/FormField";
import FormSection from "@/components/ui/FormSection";
import FormDatePicker from "@/components/ui/FormDatePicker";
import PodLrAutocomplete from "./PodLrAutocomplete";
import type { Pod } from "./pod.schema";
import type { LRRecord } from "@/components/services/lr.service";
import type { FieldErrors } from "@/lib/validation";
import { podFieldHelp } from "@/lib/help";
import { cn } from "@/lib/utils";

interface PodFormProps {
  pod: Pod;
  errors?: FieldErrors<Pod>;
  onChange: (pod: Pod) => void;
  /** The full LR matching `pod.lrNumber`, resolved by the caller — used
   * only to display read-only verification fields; never edited here. */
  selectedLR: LRRecord | null;
  onSelectLR: (lr: LRRecord) => void;
  onClearLR?: () => void;
  onProofSelect: (file: File) => void;
  uploadingProof?: boolean;
  readOnly?: boolean;
  /** When true (edit/view), LR number is locked; create mode uses autocomplete. */
  lockLrNumber?: boolean;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value || "—"}</p>
    </div>
  );
}

const PROOF_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

function isAllowedPodProofFile(file: File): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (
    type === "application/pdf" ||
    type === "image/jpeg" ||
    type === "image/png"
  ) {
    return true;
  }
  return /\.(pdf|jpe?g|png)$/.test(name);
}

/**
 * Proof of Delivery form. Settlement fields are not shown here —
 * they are entered only in Financials. POD DB columns remain for
 * historical compatibility and are preserved on save via PodDialog.
 */
export default function PodForm({
  pod,
  errors = {},
  onChange,
  selectedLR,
  onSelectLR,
  onClearLR,
  onProofSelect,
  uploadingProof = false,
  readOnly = false,
  lockLrNumber = false,
}: PodFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function update<K extends keyof Pod>(key: K, value: Pod[K]) {
    onChange({ ...pod, [key]: value });
  }

  function acceptProofFile(file: File | null | undefined) {
    if (!file || readOnly || uploadingProof) return;

    if (!isAllowedPodProofFile(file)) {
      toast.error("Proof must be a PDF, JPG, JPEG, or PNG file.");
      return;
    }

    // Do not silently replace an existing proof via drag/paste.
    if (pod.proofUrl) {
      toast.message("A proof file is already uploaded. Use Replace file to change it.");
      return;
    }

    onProofSelect(file);
  }

  function handleReplaceClick() {
    if (readOnly || uploadingProof) return;
    fileInputRef.current?.click();
  }

  function handleFileInputChange(file: File | undefined) {
    if (!file || readOnly || uploadingProof) return;
    if (!isAllowedPodProofFile(file)) {
      toast.error("Proof must be a PDF, JPG, JPEG, or PNG file.");
      return;
    }
    // Explicit Replace / Upload click may overwrite.
    onProofSelect(file);
  }

  return (
    <FormSection title="Proof of Delivery" className="overflow-visible">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FormField
          label="LR Number"
          htmlFor="pod-lr-number"
          required
          error={errors.lrNumber}
          helpText={podFieldHelp.lrNumber}
          className="sm:col-span-2"
        >
          {lockLrNumber || readOnly ? (
            <Input
              id="pod-lr-number"
              placeholder="Select an LR"
              value={pod.lrNumber}
              readOnly
            />
          ) : (
            <PodLrAutocomplete
              id="pod-lr-number"
              selectedLR={selectedLR}
              onSelect={onSelectLR}
              onClearSelection={onClearLR}
              disabled={readOnly}
            />
          )}
        </FormField>

        {selectedLR && (
          <div className="grid grid-cols-1 gap-4 rounded-lg border bg-muted/30 p-4 sm:col-span-2 sm:grid-cols-3">
            <ReadOnlyField label="Consignor" value={selectedLR.consignor} />
            <ReadOnlyField label="Consignee" value={selectedLR.consignee} />
            <ReadOnlyField
              label="Vehicle Number"
              value={selectedLR.vehicleNumber}
            />
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
          helpText={podFieldHelp.podDate}
          value={pod.podDate}
          onChange={(value) => update("podDate", value)}
          disabled={readOnly}
        />

        <FormField
          label="Unloading Weight"
          htmlFor="pod-unloading-weight"
          required
          error={errors.unloadingWeight}
          helpText={podFieldHelp.unloadingWeight}
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
          helpText={podFieldHelp.unloadingDate}
          value={pod.unloadingDate}
          onChange={(value) => update("unloadingDate", value)}
          disabled={readOnly}
        />

        <FormField
          label="Proof of POD"
          htmlFor="pod-proof-file"
          helpText={podFieldHelp.proofUrl}
          hint="PDF, JPG, JPEG or PNG. Click, drag & drop, or paste (⌘/Ctrl+V)."
          className="sm:col-span-2"
        >
          <div
            ref={dropZoneRef}
            tabIndex={readOnly ? -1 : 0}
            role="button"
            aria-label="POD proof upload area"
            className={cn(
              "rounded-lg border border-dashed bg-muted/20 p-4 outline-none transition-colors",
              dragOver && "border-primary bg-primary/5",
              !readOnly && "focus-visible:ring-2 focus-visible:ring-ring"
            )}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!readOnly && !uploadingProof) setDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!readOnly && !uploadingProof) setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) {
                setDragOver(false);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              acceptProofFile(file);
            }}
            onPaste={(e) => {
              if (readOnly || uploadingProof) return;
              const items = Array.from(e.clipboardData?.items ?? []);
              const imageItem = items.find((item) =>
                item.type.startsWith("image/")
              );
              if (!imageItem) return;
              e.preventDefault();
              const blob = imageItem.getAsFile();
              if (!blob) return;
              const ext =
                blob.type === "image/png"
                  ? "png"
                  : blob.type === "image/jpeg"
                    ? "jpg"
                    : "png";
              const file = new File([blob], `pod-proof-paste.${ext}`, {
                type: blob.type || "image/png",
              });
              acceptProofFile(file);
            }}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={readOnly || uploadingProof}
                onClick={handleReplaceClick}
              >
                {uploadingProof
                  ? "Uploading..."
                  : pod.proofUrl
                    ? "Replace file"
                    : "Upload file"}
              </Button>

              {pod.proofUrl ? (
                <a
                  href={pod.proofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline underline-offset-2"
                >
                  View uploaded file
                </a>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {dragOver
                    ? "Drop POD proof here"
                    : "Drop a file here, or paste an image while this area is focused"}
                </p>
              )}
            </div>

            <input
              ref={fileInputRef}
              id="pod-proof-file"
              type="file"
              accept={PROOF_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                handleFileInputChange(file);
                e.target.value = "";
              }}
            />
          </div>
        </FormField>
      </div>
    </FormSection>
  );
}
