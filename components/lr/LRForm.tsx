"use client";

import { useState } from "react";

import type { LR } from "./lr.schema";
import type { FieldErrors } from "@/lib/validation";
import type { LRRecord } from "@/components/services/lr.service";

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
  /** View mode: all controls non-interactive (matches POD/ASN read-only pattern). */
  readOnly?: boolean;
  /** Exclude this LR from DC duplicate warnings while editing. */
  excludeLrId?: LRRecord["id"] | null;
}

export default function LRForm({
  lr,
  errors = {},
  onChange,
  nextLrNumberPreview,
  requireMaterialDescription = false,
  readOnly = false,
  excludeLrId = null,
}: LRFormProps) {
  const [poSelectionRequested, setPoSelectionRequested] = useState(false);
  return (
    <div className="space-y-6" {...(readOnly ? { inert: true as const } : {})}>
      <LRHeader
        lr={lr}
        errors={errors}
        onChange={(next) => {
          if (next.customer !== lr.customer) {
            setPoSelectionRequested(true);
            onChange({ ...next, poNumber: "", poDate: "", purchaseOrderId: null });
          } else onChange(next);
        }}
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
        excludeLrId={excludeLrId}
        readOnly={readOnly}
        autoSelectPo={poSelectionRequested || !excludeLrId || lr.entryStatus === "draft"}
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
