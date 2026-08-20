"use client";

import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import FormField from "@/components/ui/FormField";
import FormSection from "@/components/ui/FormSection";

import MaterialLookup from "@/components/lookup/MaterialLookup";
import {
  getMaterials,
  type MaterialRecord,
} from "@/components/services/material.service";

import LRNumericInput from "../LRNumericInput";
import type { LR } from "../lr.schema";
import type { FieldErrors } from "@/lib/validation";
import { lrFieldHelp } from "@/lib/help";
import {
  matchMaterialsByDescription,
  type MaterialMatchCandidate,
} from "../materialDescriptionMatch";

interface MaterialSectionProps {
  lr: LR;
  errors?: FieldErrors<LR>;
  onChange: (lr: LR) => void;
  /** Show required indicator + enforce via parent validation for new/draft LRs. */
  requireMaterialDescription?: boolean;
}

export default function MaterialSection({
  lr,
  errors = {},
  onChange,
  requireMaterialDescription = false,
}: MaterialSectionProps) {
  const [lookupOpen, setLookupOpen] = useState(false);
  const [materials, setMaterials] = useState<MaterialRecord[]>([]);
  const [debouncedDescription, setDebouncedDescription] = useState(
    lr.materialDescription ?? "",
  );

  useEffect(() => {
    let cancelled = false;
    getMaterials()
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

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedDescription(lr.materialDescription ?? "");
    }, 300);
    return () => window.clearTimeout(handle);
  }, [lr.materialDescription]);

  const match = useMemo(
    () => matchMaterialsByDescription(debouncedDescription, materials),
    [debouncedDescription, materials],
  );

  function update<K extends keyof LR>(key: K, value: LR[K]) {
    onChange({ ...lr, [key]: value });
  }

  /** Sets Material Master name only — never overwrites materialDescription. */
  function applyMaterial(candidate: MaterialMatchCandidate) {
    onChange({
      ...lr,
      material: candidate.materialName,
      packageType: candidate.unit || lr.packageType,
      materialDescription: lr.materialDescription ?? "",
    });
  }

  /** Manual lookup selection — preserves staff-entered materialDescription. */
  function handleMaterialSelect(material: MaterialRecord) {
    onChange({
      ...lr,
      material: material.materialName,
      packageType: material.unit,
      materialDescription: lr.materialDescription ?? "",
    });
  }

  // Suggestions are advisory only: editing the description never auto-sets material.
  const showMatchPanel =
    normalizeHasText(debouncedDescription) &&
    debouncedDescription.trim().length >= 2;

  return (
    <>
      <FormSection
        title="Material Details"
        subtitle="Enter the material description first, then confirm the Material Master name"
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          <FormField
            label="Material Description"
            htmlFor="lr-material-description"
            required={requireMaterialDescription}
            error={errors.materialDescription}
            helpText={lrFieldHelp.materialDescription}
            hint="Type the description for this LR. Matching uses Material Master reference descriptions only as suggestions."
            className="lg:col-span-3"
          >
            <Input
              id="lr-material-description"
              placeholder="e.g. Unshredded RDF"
              value={lr.materialDescription ?? ""}
              maxLength={500}
              onChange={(e) => update("materialDescription", e.target.value)}
            />
          </FormField>

          {showMatchPanel ? (
            <div className="lg:col-span-3 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm space-y-2">
              {match.tier === "exact" && match.candidates[0] ? (
                <>
                  <p className="text-foreground">
                    Suggested Material:{" "}
                    <span className="font-medium">
                      {match.candidates[0].materialName}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => applyMaterial(match.candidates[0])}
                    >
                      Use {match.candidates[0].materialName}
                    </Button>
                  </div>
                </>
              ) : null}

              {match.tier === "multiple" ? (
                <>
                  <p className="text-foreground">
                    Possible material matches — please select the correct
                    material.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {match.candidates.map((c) => (
                      <Button
                        key={c.materialName}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => applyMaterial(c)}
                      >
                        {c.materialName}
                      </Button>
                    ))}
                  </div>
                </>
              ) : null}

              {match.tier === "possible" && match.candidates[0] ? (
                <>
                  <p className="text-foreground">
                    Possible match — please verify:{" "}
                    <span className="font-medium">
                      {match.candidates[0].materialName}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => applyMaterial(match.candidates[0])}
                    >
                      Use {match.candidates[0].materialName}
                    </Button>
                  </div>
                </>
              ) : null}

              {match.tier === "none" ? (
                <p className="text-amber-800 dark:text-amber-200">
                  No confident material match found. Please consult your
                  Senior/Admin before proceeding.
                </p>
              ) : null}
            </div>
          ) : null}

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

function normalizeHasText(value: string): boolean {
  return value.trim().length > 0;
}
