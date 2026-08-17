"use client";

import { useMemo, useState } from "react";

import FormDatePicker from "@/components/ui/FormDatePicker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { todayIsoDate } from "@/lib/draftPersistence";

export type OverviewPeriodPreset = "today" | "week" | "month" | "custom";

export interface OverviewPeriodValue {
  preset: OverviewPeriodPreset;
  fromDate: string;
  toDate: string;
}

interface OverviewPeriodFilterProps {
  value: OverviewPeriodValue;
  onChange: (next: OverviewPeriodValue) => void;
}

function startOfWeekIso(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  d.setDate(d.getDate() + diff);
  return todayIsoDate(d);
}

function startOfMonthIso(date: Date = new Date()): string {
  return todayIsoDate(new Date(date.getFullYear(), date.getMonth(), 1));
}

export function defaultOverviewPeriod(
  preset: OverviewPeriodPreset = "today"
): OverviewPeriodValue {
  const today = todayIsoDate();
  if (preset === "week") {
    return { preset, fromDate: startOfWeekIso(), toDate: today };
  }
  if (preset === "month") {
    return { preset, fromDate: startOfMonthIso(), toDate: today };
  }
  return { preset: "today", fromDate: today, toDate: today };
}

const PRESETS: Array<{ key: OverviewPeriodPreset; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "custom", label: "Custom" },
];

export default function OverviewPeriodFilter({
  value,
  onChange,
}: OverviewPeriodFilterProps) {
  const [customFrom, setCustomFrom] = useState(value.fromDate);
  const [customTo, setCustomTo] = useState(value.toDate);

  const rangeLabel = useMemo(() => {
    if (value.fromDate === value.toDate) return value.fromDate;
    return `${value.fromDate} → ${value.toDate}`;
  }, [value.fromDate, value.toDate]);

  function applyPreset(preset: OverviewPeriodPreset) {
    if (preset === "custom") {
      onChange({
        preset: "custom",
        fromDate: customFrom || value.fromDate,
        toDate: customTo || value.toDate,
      });
      return;
    }
    onChange(defaultOverviewPeriod(preset));
  }

  function applyCustom() {
    const from = customFrom || todayIsoDate();
    const to = customTo || from;
    onChange({
      preset: "custom",
      fromDate: from <= to ? from : to,
      toDate: from <= to ? to : from,
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Button
            key={preset.key}
            type="button"
            size="sm"
            variant={value.preset === preset.key ? "default" : "outline"}
            className={cn(value.preset === preset.key && "shadow-sm")}
            onClick={() => applyPreset(preset.key)}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Period: <span className="font-medium text-foreground">{rangeLabel}</span>
      </p>

      {value.preset === "custom" && (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <FormDatePicker
            label="From Date"
            value={customFrom}
            onChange={setCustomFrom}
            className="sm:w-48"
          />
          <FormDatePicker
            label="To Date"
            value={customTo}
            onChange={setCustomTo}
            className="sm:w-48"
          />
          <Button type="button" onClick={applyCustom}>
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}
