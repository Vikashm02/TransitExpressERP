"use client";

import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import FormField from "@/components/ui/FormField";
import FormSection from "@/components/ui/FormSection";
import MaterialLookup from "@/components/lookup/MaterialLookup";
import {
  getLrMaterialLookup,
  type LrMaterialLookupRow,
} from "@/components/services/material.service";
import LRNumericInput from "../LRNumericInput";
import type { LR } from "../lr.schema";
import type { FieldErrors } from "@/lib/validation";
import { lrFieldHelp } from "@/lib/help";

interface MaterialSectionProps {
  lr: LR;
  errors?: FieldErrors<LR>;
  onChange: (lr: LR) => void;
  requireMaterialDescription?: boolean;
}

export default function MaterialSection({
  lr,
  errors = {},
  onChange,
  requireMaterialDescription = false,
}: MaterialSectionProps) {
  const [lookupOpen, setLookupOpen] = useState(false);
  const [materials, setMaterials] = useState<LrMaterialLookupRow[]>([]);
  const [recommendationSearch, setRecommendationSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    getLrMaterialLookup()
      .then((rows) => {
        if (!cancelled) setMaterials(rows);
      })
      .catch(() => {
        if (!cancelled) setMaterials([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedMaterial = useMemo(
    () => materials.find((material) => material.materialName === lr.material),
    [materials, lr.material],
  );

  const visibleRecommendations = useMemo(() => {
    const query = recommendationSearch.trim().toLocaleLowerCase();
    return (selectedMaterial?.recommendedDescriptions ?? []).filter(
      (description) => !query || description.toLocaleLowerCase().includes(query),
    );
  }, [recommendationSearch, selectedMaterial]);

  function update<K extends keyof LR>(key: K, value: LR[K]) {
    onChange({ ...lr, [key]: value });
  }

  // Selection changes only the material snapshot and package type. It never
  // rewrites a historical or staff-entered description.
  function handleMaterialSelect(material: LrMaterialLookupRow) {
    setRecommendationSearch("");
    onChange({
      ...lr,
      material: material.materialName,
      packageType: material.unit || lr.packageType,
      materialDescription: lr.materialDescription ?? "",
    });
  }

  return (
    <>
      <FormSection
        title="Material Details"
        subtitle="Select a canonical material, then choose a suggested description or enter your own"
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
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
              <Button type="button" variant="outline" onClick={() => setLookupOpen(true)}>
                Search
              </Button>
            </div>
          </FormField>

          <FormField label="Package Type" htmlFor="lr-package-type" required error={errors.packageType}>
            <Input
              id="lr-package-type"
              placeholder="Bundle / Bag / Coil"
              value={lr.packageType}
              onChange={(event) => update("packageType", event.target.value)}
            />
          </FormField>

          <FormField
            label="Material Description"
            htmlFor="lr-material-description"
            required={requireMaterialDescription}
            error={errors.materialDescription}
            helpText={lrFieldHelp.materialDescription}
            hint="Use a recommendation or type the exact wording for this LR. It remains free text."
            className="lg:col-span-3"
          >
            <Input
              id="lr-material-description"
              placeholder="e.g. Shredded RDF from MSW"
              value={lr.materialDescription ?? ""}
              maxLength={500}
              onChange={(event) => update("materialDescription", event.target.value)}
            />
          </FormField>

          {selectedMaterial?.recommendedDescriptions.length ? (
            <div className="lg:col-span-3 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm">
              <p className="mb-2 text-foreground">Recommended descriptions for {selectedMaterial.materialName}</p>
              <Input
                aria-label="Search recommended descriptions"
                value={recommendationSearch}
                onChange={(event) => setRecommendationSearch(event.target.value)}
                placeholder="Search recommendations"
                className="mb-2 max-w-md"
              />
              <div className="flex flex-wrap gap-2">
                {visibleRecommendations.map((description) => (
                  <Button
                    key={description}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => update("materialDescription", description)}
                  >
                    {description}
                  </Button>
                ))}
                {visibleRecommendations.length === 0 ? (
                  <p className="text-muted-foreground">No matching recommendations. You can still enter free text above.</p>
                ) : null}
              </div>
            </div>
          ) : null}

          <FormField label="No. of Packages" htmlFor="lr-packages" error={errors.packages}>
            <LRNumericInput id="lr-packages" value={lr.packages} onChange={(value) => update("packages", value)} />
          </FormField>
          <FormField label="Loading Weight (MT)" htmlFor="lr-loading-weight" required error={errors.loadingWeight}>
            <LRNumericInput id="lr-loading-weight" value={lr.loadingWeight} onChange={(value) => update("loadingWeight", value)} />
          </FormField>
          <FormField label="Charged Weight (MT)" htmlFor="lr-charged-weight" error={errors.chargedWeight}>
            <LRNumericInput id="lr-charged-weight" value={lr.chargedWeight} onChange={(value) => update("chargedWeight", value)} />
          </FormField>
        </div>
      </FormSection>

      <MaterialLookup
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelect={handleMaterialSelect}
        loadMaterials={getLrMaterialLookup}
      />
    </>
  );
}
