"use client";

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";

interface LRNumericInputProps {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: string | number;
  placeholder?: string;
}

/**
 * Normalize parent form values for display. Never treat numeric 0 as
 * "missing" via a falsy check (`value || …`) — 0 is a real value.
 * null/undefined/NaN → 0 for form state semantics (matches emptyLR).
 */
function toSafeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** DOM-controlled input must always receive a string, never null/undefined. */
function toDisplayDraft(value: number): string {
  return value === 0 ? "" : String(value);
}

/**
 * Numeric input for LR entry fields that starts empty instead of showing a
 * prefilled "0" the user has to delete first. Keeps its own draft string so
 * partial/decimal entry (e.g. "12.", "0.5") isn't clobbered mid-keystroke,
 * while still reporting a plain `number` (0 for an empty field) to the
 * parent on every valid change. Scoped to LR entry only — other modules'
 * numeric inputs are unchanged.
 */
export default function LRNumericInput({
  id,
  value,
  onChange,
  min = 0,
  step,
  placeholder,
}: LRNumericInputProps) {
  const safeValue = toSafeNumber(value);
  const [draft, setDraft] = useState(() => toDisplayDraft(safeValue));

  useEffect(() => {
    const next = toSafeNumber(value);
    const draftAsNumber = draft === "" ? 0 : Number(draft);

    // Only resync from the parent when it no longer matches what's being
    // typed (e.g. the dialog reset to a different/new LR) — this avoids
    // wiping in-progress decimal entry on every re-render.
    if (Number.isNaN(draftAsNumber) || draftAsNumber !== next) {
      setDraft(toDisplayDraft(next));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Input
      id={id}
      type="number"
      min={min}
      step={step}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);

        const parsed = Number(raw);
        onChange(raw === "" || Number.isNaN(parsed) ? 0 : parsed);
      }}
    />
  );
}
