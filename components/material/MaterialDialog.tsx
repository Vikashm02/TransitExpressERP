"use client";

import { useEffect, useState } from "react";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";
import MaterialForm from "./MaterialForm";
import { validateMaterial, type Material } from "./material.schema";
import type { FieldErrors } from "@/lib/validation";
import type { MaterialRecord } from "@/components/services/material.service";
import { pickFields } from "@/lib/utils";

interface MaterialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a record to edit; omit/null to add a new material. */
  material?: MaterialRecord | null;
  /** Shows the FormDialog's blocking "Saving..." overlay while a save is in flight. */
  loading?: boolean;
  onSubmit: (values: Material) => void | Promise<void>;
}

const emptyMaterial: Material = {
  code: "",
  materialName: "",
  category: "",
  hsnCode: "",
  unit: "",
  gstPercentage: 0,
  description: "",
  status: "Active",
};

/** Picks only the `Material` schema fields off a `MaterialRecord`, dropping
 * server-owned columns (`id`, `created_at`) so they never enter editable
 * form state — and therefore never reach `updateMaterial()`'s payload. */
function toEditableMaterial(record: MaterialRecord): Material {
  return pickFields(record, Object.keys(emptyMaterial) as (keyof Material)[]);
}

export default function MaterialDialog({
  open,
  onOpenChange,
  material,
  loading = false,
  onSubmit,
}: MaterialDialogProps) {
  const [values, setValues] = useState<Material>(emptyMaterial);
  const [errors, setErrors] = useState<FieldErrors<Material>>({});

  const isEditing = Boolean(material);

  useEffect(() => {
    if (open) {
      setValues(material ? { ...emptyMaterial, ...toEditableMaterial(material) } : emptyMaterial);
      setErrors({});
    }
  }, [open, material]);

  function handleSave() {
    const fieldErrors = validateMaterial(values);

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    onSubmit(values);
  }

  function handleCancel() {
    onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "Edit Material" : "Add Material"}
      description={
        isEditing
          ? "Update the material details below."
          : "Enter the material details below."
      }
      loading={loading}
      loadingText="Saving material..."
      footer={
        <>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={loading}
          >
            Cancel
          </Button>

          <Button
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? "Saving..." : "Save Material"}
          </Button>
        </>
      }
    >
      <MaterialForm
        material={values}
        errors={errors}
        onChange={setValues}
        isNew={!isEditing}
      />
    </FormDialog>
  );
}
