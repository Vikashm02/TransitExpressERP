"use client";

import { Button } from "@/components/ui/button";

import { LR } from "./types";

import LRHeader from "./sections/LRHeader";
import ConsignorSection from "./sections/ConsignorSection";
import ConsigneeSection from "./sections/ConsigneeSection";
import VehicleSection from "./sections/VehicleSection";
import MaterialSection from "./sections/MaterialSection";
import DispatchDocumentsSection from "./sections/DispatchDocumentsSection";
import CommercialSection from "./sections/CommercialSection";
import RemarksSection from "./sections/RemarksSection";

interface LRFormProps {
  lr: LR;
  onChange: (lr: LR) => void;
  onSave: () => void;
  onCancel: () => void;
}

export default function LRForm({
  lr,
  onChange,
  onSave,
  onCancel,
}: LRFormProps) {
  return (
    <div className="space-y-6 pb-32">

      {/* ==========================
          LR HEADER
      ========================== */}

      <LRHeader
        lr={lr}
        onChange={onChange}
      />

      {/* ==========================
          CONSIGNOR / CONSIGNEE
      ========================== */}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        <ConsignorSection
          lr={lr}
          onChange={onChange}
        />

        <ConsigneeSection
          lr={lr}
          onChange={onChange}
        />

      </div>

      {/* ==========================
          VEHICLE / MATERIAL
      ========================== */}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        <VehicleSection
          lr={lr}
          onChange={onChange}
        />

        <MaterialSection
          lr={lr}
          onChange={onChange}
        />

      </div>

      {/* ==========================
          DOCUMENTS
      ========================== */}

      <DispatchDocumentsSection
        lr={lr}
        onChange={onChange}
      />

      {/* ==========================
          COMMERCIAL
      ========================== */}

      <CommercialSection
        lr={lr}
        onChange={onChange}
      />

      {/* ==========================
          REMARKS
      ========================== */}

      <RemarksSection
        lr={lr}
        onChange={onChange}
      />

      {/* ==========================
          STICKY FOOTER
      ========================== */}

      <div className="sticky bottom-0 left-0 bg-white border-t p-4 flex justify-end gap-3 shadow-lg">

        <Button
          variant="outline"
          size="lg"
          onClick={onCancel}
        >
          Cancel
        </Button>

        <Button
          size="lg"
          onClick={onSave}
        >
          Save LR
        </Button>

      </div>

    </div>
  );
}