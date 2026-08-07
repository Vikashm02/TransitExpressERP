"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";
import FormSection from "@/components/ui/FormSection";
import {
  MATERIAL_CATEGORY_OPTIONS,
  MATERIAL_STATUS_OPTIONS,
  MATERIAL_UNIT_OPTIONS,
  type Material,
} from "./material.schema";
import type { FieldErrors } from "@/lib/validation";

interface MaterialFormProps {
  material: Material;
  errors?: FieldErrors<Material>;
  onChange: (material: Material) => void;
  /** Whether this is a new (not-yet-created) material — controls the Material Code placeholder. */
  isNew?: boolean;
}

function toOptions(values: readonly string[]) {
  return values.map((value) => ({ label: value, value }));
}

export default function MaterialForm({
  material,
  errors = {},
  onChange,
  isNew = false,
}: MaterialFormProps) {
  function update<K extends keyof Material>(key: K, value: Material[K]) {
    onChange({ ...material, [key]: value });
  }

  return (
    <FormSection title="Basic Information">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FormField
          label="Material Code"
          htmlFor="material-code"
          hint="Generated automatically and cannot be changed."
        >
          <Input
            id="material-code"
            value={material.code}
            placeholder={isNew ? "Auto Generated" : ""}
            disabled
            readOnly
          />
        </FormField>

        <FormField
          label="Material Name"
          htmlFor="material-name"
          required
          error={errors.materialName}
        >
          <Input
            id="material-name"
            placeholder="Material Name"
            value={material.materialName}
            onChange={(e) => update("materialName", e.target.value)}
          />
        </FormField>

        <FormSelect
          label="Material Category"
          id="material-category"
          error={errors.category}
          value={material.category}
          onValueChange={(value) => update("category", value)}
          options={toOptions(MATERIAL_CATEGORY_OPTIONS)}
        />

        <FormField
          label="HSN Code"
          htmlFor="material-hsn-code"
          error={errors.hsnCode}
        >
          <Input
            id="material-hsn-code"
            placeholder="HSN Code"
            value={material.hsnCode}
            onChange={(e) => update("hsnCode", e.target.value)}
          />
        </FormField>

        <FormSelect
          label="Unit"
          id="material-unit"
          error={errors.unit}
          value={material.unit}
          onValueChange={(value) => update("unit", value)}
          options={toOptions(MATERIAL_UNIT_OPTIONS)}
        />

        <FormField
          label="GST Percentage"
          htmlFor="material-gst-percentage"
          error={errors.gstPercentage}
        >
          <Input
            id="material-gst-percentage"
            type="number"
            min={0}
            max={100}
            placeholder="0"
            value={material.gstPercentage}
            onChange={(e) => update("gstPercentage", Number(e.target.value))}
          />
        </FormField>

        <FormSelect
          label="Status"
          id="material-status"
          value={material.status}
          onValueChange={(value) => update("status", value as Material["status"])}
          options={toOptions(MATERIAL_STATUS_OPTIONS)}
        />

        <FormField
          label="Description / Remarks"
          htmlFor="material-description"
          className="sm:col-span-2"
        >
          <Textarea
            id="material-description"
            placeholder="Description / Remarks"
            value={material.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </FormField>
      </div>
    </FormSection>
  );
}
