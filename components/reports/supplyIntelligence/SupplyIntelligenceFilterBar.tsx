"use client";

import FormSelect from "@/components/ui/FormSelect";
import FormDatePicker from "@/components/ui/FormDatePicker";
import { Button } from "@/components/ui/button";
import type { SupplyIntelligenceWindow } from "@/components/services/supplyIntelligence.service";

const WINDOW_OPTIONS: { value: SupplyIntelligenceWindow; label: string }[] = [
  { value: "90", label: "90 Days" },
  { value: "180", label: "180 Days" },
  { value: "365", label: "365 Days" },
  { value: "custom", label: "Custom" },
];

export interface SupplyFilterState {
  window: SupplyIntelligenceWindow;
  fromDate: string;
  toDate: string;
  material: string;
  consignee: string;
}

interface SupplyIntelligenceFilterBarProps {
  value: SupplyFilterState;
  materials: string[];
  consignees: string[];
  loading?: boolean;
  onChange: (next: SupplyFilterState) => void;
  onApply: () => void;
}

export default function SupplyIntelligenceFilterBar({
  value,
  materials,
  consignees,
  loading,
  onChange,
  onApply,
}: SupplyIntelligenceFilterBarProps) {
  const materialOptions = [
    { value: "", label: "All materials" },
    ...materials.map((m) => ({ value: m, label: m })),
  ];
  const consigneeOptions = [
    { value: "", label: "All consignees" },
    ...consignees.map((c) => ({ value: c, label: c })),
  ];

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormSelect
          label="Analysis period"
          id="supply-window"
          value={value.window}
          onValueChange={(next) => {
            if (
              next === "90" ||
              next === "180" ||
              next === "365" ||
              next === "custom"
            ) {
              onChange({ ...value, window: next });
            }
          }}
          options={WINDOW_OPTIONS}
        />
        <FormSelect
          label="Material"
          id="supply-material"
          value={value.material}
          onValueChange={(next) => onChange({ ...value, material: next })}
          options={materialOptions}
        />
        <FormSelect
          label="Consignee"
          id="supply-consignee"
          value={value.consignee}
          onValueChange={(next) => onChange({ ...value, consignee: next })}
          options={consigneeOptions}
        />
        <div className="flex items-end">
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={onApply}
            disabled={loading}
          >
            {loading ? "Loading…" : "Apply"}
          </Button>
        </div>
      </div>

      {value.window === "custom" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormDatePicker
            label="From date"
            id="supply-from"
            value={value.fromDate}
            onChange={(next) => onChange({ ...value, fromDate: next })}
          />
          <FormDatePicker
            label="To date"
            id="supply-to"
            value={value.toDate}
            onChange={(next) => onChange({ ...value, toDate: next })}
          />
        </div>
      ) : null}
    </div>
  );
}
