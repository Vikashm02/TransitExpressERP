"use client";

import { useEffect, useState } from "react";

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
  notificationFocus?: string | null;
}

export default function LRForm({
  lr,
  errors = {},
  onChange,
  nextLrNumberPreview,
  requireMaterialDescription = false,
  readOnly = false,
  excludeLrId = null,
  notificationFocus = null,
}: LRFormProps) {
  const [poSelectionRequested, setPoSelectionRequested] = useState(false);
  useEffect(() => {
    if (!notificationFocus) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector(`[data-lr-notification-focus="${notificationFocus}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [notificationFocus, lr.lrNumber]);
  return (
    <div className="space-y-6" {...(readOnly ? { inert: true as const } : {})}>
      <div data-lr-notification-focus="lr" className={notificationFocus === "lr" ? "rounded-xl ring-2 ring-primary/60" : undefined}><LRHeader
        lr={lr}
        errors={errors}
        onChange={(next) => {
          if (next.customer !== lr.customer || next.consignor !== lr.consignor) {
            setPoSelectionRequested(true);
            onChange({ ...next, poNumber: "", poDate: "", purchaseOrderId: null });
          } else onChange(next);
        }}
        nextLrNumberPreview={nextLrNumberPreview}
      /></div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div data-lr-notification-focus="party" className={notificationFocus === "party" ? "rounded-xl ring-2 ring-primary/60" : undefined}><PartySection
          role="consignor"
          lr={lr}
          errors={errors}
          onChange={onChange}
        /></div>

        <div data-lr-notification-focus="party" className={notificationFocus === "party" ? "rounded-xl ring-2 ring-primary/60" : undefined}><PartySection
          role="consignee"
          lr={lr}
          errors={errors}
          onChange={onChange}
        /></div>
      </div>

      <div data-lr-notification-focus="vehicle" className={notificationFocus === "vehicle" ? "rounded-xl ring-2 ring-primary/60" : undefined}><VehicleSection
        lr={lr}
        errors={errors}
        onChange={onChange}
      /></div>

      <div data-lr-notification-focus="material" className={notificationFocus === "material" ? "rounded-xl ring-2 ring-primary/60" : undefined}><MaterialSection
        lr={lr}
        errors={errors}
        onChange={onChange}
        requireMaterialDescription={requireMaterialDescription}
      /></div>

      <div data-lr-notification-focus="dispatch" className={notificationFocus === "dispatch" ? "rounded-xl ring-2 ring-primary/60" : undefined}><DispatchDocumentsSection
        lr={lr}
        errors={errors}
        onChange={onChange}
        excludeLrId={excludeLrId}
        readOnly={readOnly}
        autoSelectPo={poSelectionRequested || !excludeLrId || lr.entryStatus === "draft"}
      /></div>

      <CommercialSection
        lr={lr}
        errors={errors}
        onChange={onChange}
      />

      <div data-lr-notification-focus="remarks" className={notificationFocus === "remarks" ? "rounded-xl ring-2 ring-primary/60" : undefined}><RemarksSection
        lr={lr}
        errors={errors}
        onChange={onChange}
      /></div>
    </div>
  );
}
