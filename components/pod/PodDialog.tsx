"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";
import PodForm from "./PodForm";
import LRLookup from "@/components/lookup/LRLookup";
import { validatePod, type Pod } from "./pod.schema";
import { uploadPodProof, type PodRecord } from "@/components/services/pod.service";
import { getLRs, type LRRecord } from "@/components/services/lr.service";
import { getLorryExpenseByLrId, type LorryExpenseRecord } from "@/components/services/lorryExpense.service";
import type { FieldErrors } from "@/lib/validation";
import { pickFields } from "@/lib/utils";

interface PodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a record to view/edit; omit/null to add a new POD. */
  pod?: PodRecord | null;
  /** Shows the FormDialog's blocking "Saving..." overlay while a save is in flight. */
  loading?: boolean;
  /** Renders every field disabled and hides Save — used by the "View" action. */
  readOnly?: boolean;
  onSubmit: (values: Pod) => void | Promise<void>;
}

const emptyPod: Pod = {
  lrNumber: "",
  podDate: "",
  unloadingWeight: 0,
  unloadingDate: "",
  proofUrl: "",
  stChalan: 0,
  tdsPercentage: 0,
  otherDeduction: 0,
  balancePaidOn: "",
};

/** Picks only the `Pod` schema fields off a `PodRecord`, dropping
 * server-owned columns (`id`, `created_at`) so they never enter editable
 * form state — and therefore never reach `updatePod()`'s payload. */
function toEditablePod(record: PodRecord): Pod {
  return pickFields(record, Object.keys(emptyPod) as (keyof Pod)[]);
}

export default function PodDialog({
  open,
  onOpenChange,
  pod,
  loading = false,
  readOnly = false,
  onSubmit,
}: PodDialogProps) {
  const [values, setValues] = useState<Pod>(emptyPod);
  const [errors, setErrors] = useState<FieldErrors<Pod>>({});
  const [lrs, setLrs] = useState<LRRecord[]>([]);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [lorryExpense, setLorryExpense] = useState<LorryExpenseRecord | null>(null);

  const isEditing = Boolean(pod);
  const selectedLR = lrs.find((lr) => lr.lrNumber === values.lrNumber) ?? null;

  useEffect(() => {
    if (open) {
      setValues(pod ? { ...emptyPod, ...toEditablePod(pod) } : emptyPod);
      setErrors({});
      getLRs()
        .then(setLrs)
        .catch((error) => console.error(error));
    }
  }, [open, pod]);

  // Feeds the read-only settlement preview in PodForm — Lorry Expenses
  // (if any exist yet for this LR) plus this POD's own ST
  // Chalan/TDS/Other Deduction fields determine the Balance Payable,
  // via the same lib/calculations/lorrySettlement.ts formula the Lorry
  // Expenses module itself uses.
  useEffect(() => {
    if (!selectedLR) {
      setLorryExpense(null);
      return;
    }

    let cancelled = false;

    getLorryExpenseByLrId(selectedLR.id)
      .then((data) => {
        if (!cancelled) setLorryExpense(data);
      })
      .catch((error) => console.error(error));

    return () => {
      cancelled = true;
    };
  }, [selectedLR]);

  function handleSelectLR(lr: LRRecord) {
    setValues((prev) => ({ ...prev, lrNumber: lr.lrNumber }));
  }

  async function handleProofSelect(file: File) {
    try {
      setUploadingProof(true);
      const url = await uploadPodProof(file);
      setValues((prev) => ({ ...prev, proofUrl: url }));
      toast.success("File uploaded successfully.");
    } catch (error) {
      console.error(error);
      toast.error('Unable to upload file. Confirm the "pod-assets" storage bucket exists.');
    } finally {
      setUploadingProof(false);
    }
  }

  function handleSave() {
    const fieldErrors = validatePod(values);

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    onSubmit(values);
  }

  function handleClose() {
    onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={readOnly ? "View POD" : isEditing ? "Edit POD" : "Add POD"}
      description={
        readOnly
          ? "Proof of delivery details."
          : isEditing
          ? "Update the proof of delivery details below."
          : "Enter the proof of delivery details below."
      }
      loading={loading}
      loadingText="Saving POD..."
      footer={
        readOnly ? (
          <Button onClick={handleClose}>
            Close
          </Button>
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
              disabled={loading}
            >
              {loading ? "Saving..." : "Save POD"}
            </Button>
          </>
        )
      }
    >
      <PodForm
        pod={values}
        errors={errors}
        onChange={setValues}
        selectedLR={selectedLR}
        lorryExpense={lorryExpense}
        blankWhenZero={!isEditing && !readOnly}
        onSearchLR={() => setLookupOpen(true)}
        onProofSelect={handleProofSelect}
        uploadingProof={uploadingProof}
        readOnly={readOnly}
      />

      <LRLookup
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelect={handleSelectLR}
      />
    </FormDialog>
  );
}
