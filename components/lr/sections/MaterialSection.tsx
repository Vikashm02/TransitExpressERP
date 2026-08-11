"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import FormField from "@/components/ui/FormField";
import FormSection from "@/components/ui/FormSection";

import MaterialLookup from "@/components/lookup/MaterialLookup";
import type { MaterialRecord } from "@/components/services/material.service";

import LRNumericInput from "../LRNumericInput";
import type { LR } from "../lr.schema";
import type { FieldErrors } from "@/lib/validation";

interface MaterialSectionProps {
  lr: LR;
  errors?: FieldErrors<LR>;
  onChange: (lr: LR) => void;
}

export default function MaterialSection({
  lr,
  errors = {},
  onChange,
}: MaterialSectionProps) {
  const [lookupOpen, setLookupOpen] = useState(false);

  function update<K extends keyof LR>(key: K, value: LR[K]) {
    onChange({ ...lr, [key]: value });
  }

  function handleMaterialSelect(material: MaterialRecord) {
    onChange({
      ...lr,
      material: material.materialName,
      packageType: material.unit,
    });
  }

  return (
    <>
      <FormSection
        title="Material Details"
        subtitle="Goods being transported"
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {/* Material — must come from Material Master; selection only,
              never free-typed (matches the same read-only + Search
              pattern already used for Billing Party in LRHeader.tsx). */}
          <FormField
            label="Material"
            htmlFor="lr-material"
            required
            error={errors.material}
            className="lg:col-span-2"
          >
            <div className="flex gap-3">
              <Input
                id="lr-material"
                readOnly
                placeholder="Select material"
                value={lr.material}
                onClick={() => setLookupOpen(true)}
              />

              <Button
                type="button"
                variant="outline"
                onClick={() => setLookupOpen(true)}
              >
                Search
              </Button>
            </div>
          </FormField>

          <FormField
            label="Package Type"
            htmlFor="lr-package-type"
          >
            <Input
              id="lr-package-type"
              placeholder="Bundle / Bag / Coil"
              value={lr.packageType}
              onChange={(e) => update("packageType", e.target.value)}
            />
          </FormField>

          <FormField
            label="No. of Packages"
            htmlFor="lr-packages"
            error={errors.packages}
          >
            <LRNumericInput
              id="lr-packages"
              value={lr.packages}
              onChange={(value) => update("packages", value)}
            />
          </FormField>

          <FormField
            label="Loading Weight (MT)"
            htmlFor="lr-loading-weight"
            required
            error={errors.loadingWeight}
          >
            <LRNumericInput
              id="lr-loading-weight"
              value={lr.loadingWeight}
              onChange={(value) => update("loadingWeight", value)}
            />
          </FormField>

          <FormField
            label="Charged Weight (MT)"
            htmlFor="lr-charged-weight"
            error={errors.chargedWeight}
          >
            <LRNumericInput
              id="lr-charged-weight"
              value={lr.chargedWeight}
              onChange={(value) => update("chargedWeight", value)}
            />
          </FormField>
          {/* Unloading Weight is captured exclusively by the POD module —
              see requirement 11: it isn't known at LR-creation time. */}
        </div>
      </FormSection>

      <MaterialLookup
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelect={handleMaterialSelect}
      />
    </>
  );
}
