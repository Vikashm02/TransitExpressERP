"use client";

import { Input } from "@/components/ui/input";
import { LR } from "../types";

interface RemarksSectionProps {
  lr: LR;
  onChange: (lr: LR) => void;
}

export default function RemarksSection({
  lr,
  onChange,
}: RemarksSectionProps) {
  return (
    <div className="rounded-lg border p-5 space-y-5">

      <h2 className="text-lg font-semibold">
        Remarks
      </h2>

      <Input
        placeholder="Remarks"
        value={lr.remarks}
        onChange={(e) =>
          onChange({
            ...lr,
            remarks: e.target.value,
          })
        }
      />

      <Input
        placeholder="Internal Remarks"
        value={lr.internalRemarks}
        onChange={(e) =>
          onChange({
            ...lr,
            internalRemarks: e.target.value,
          })
        }
      />

    </div>
  );
}