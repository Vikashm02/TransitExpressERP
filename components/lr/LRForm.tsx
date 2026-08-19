"use client";

import type { LR } from "./lr.schema";
import type { FieldErrors } from "@/lib/validation";

import LRHeader from "./sections/LRHeader";
import PartySection from "./sections/PartySection";
import VehicleSection from "./sections/VehicleSection";
import MaterialSection from "./sections/MaterialSection";
import DispatchDocumentsSection from "./sections/DispatchDocumentsSection";
import CommercialSection from "./sections/CommercialSection";
import RemarksSection from "./sections/RemarksSection";

interface LRFormProps {
  lr: LR;
  errors?: FieldErrors<LR>;
  onChange: (lr: LR) => void;
  nextLrNumberPreview?: string;
  /** When true, Material Description shows as required (new LR / draft finalize). */
  requireMaterialDescription?: boolean;
}

export default function LRForm({
  lr,
  errors = {},
  onChange,
  nextLrNumberPreview,
  requireMaterialDescription = false,
}: LRFormProps) {
  return (
    <div className="space-y-6">
      <LRHeader
        lr={lr}
        errors={errors}
        onChange={onChange}
        nextLrNumberPreview={nextLrNumberPreview}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <PartySection
          role="consignor"
          lr={lr}
          errors={errors}
          onChange={onChange}
        />

        <PartySection
          role="consignee"
          lr={lr}
          errors={errors}
          onChange={onChange}
        />
      </div>

      <VehicleSection
        lr={lr}
        errors={errors}
        onChange={onChange}
      />

      <MaterialSection
        lr={lr}
        errors={errors}
        onChange={onChange}
        requireMaterialDescription={requireMaterialDescription}
      />

      <DispatchDocumentsSection
        lr={lr}
        errors={errors}
        onChange={onChange}
      />

      <CommercialSection
        lr={lr}
        errors={errors}
        onChange={onChange}
      />

      <RemarksSection
        lr={lr}
        errors={errors}
        onChange={onChange}
      />
    </div>
  );
}
