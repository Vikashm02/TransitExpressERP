"use client";

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";

interface BlankableNumberInputProps {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: string | number;
  placeholder?: string;
  readOnly?: boolean;
  /** When true, a `0` value displays as an empty field instead of "0" —
   * used only for brand-new records so the user isn't forced to delete
   * a prefilled zero. Edit/View pass `false` so an existing saved `0`
   * (e.g. no deduction) still displays as "0", unchanged from before. */
  blankWhenZero?: boolean;
}

/**
 * Numeric input that starts empty instead of showing a prefilled "0" on
 * *new*-record creation forms. Mirrors `components/lr/LRNumericInput.tsx`
 * exactly (keeps its own draft string so partial/decimal entry like
 * "12." isn't clobbered mid-keystroke, while always reporting a plain
 * `number` — 0 for an empty field — to the parent), but lives here so
 * Credit Note and Debit Note can share it without duplicating the logic
 * or touching LRNumericInput itself (which stays scoped to LR entry).
 */
export default function BlankableNumberInput({
  id,
  value,
  onChange,
  min = 0,
  step,
  placeholder,
  readOnly,
  blankWhenZero = true,
}: BlankableNumberInputProps) {
  const [draft, setDraft] = useState(value === 0 && blankWhenZero ? "" : String(value));

  useEffect(() => {
    const draftAsNumber = draft === "" ? 0 : Number(draft);

    // Only resync from the parent when it no longer matches what's being
    // typed (e.g. the dialog reset for a different record) — this avoids
    // wiping in-progress decimal entry on every re-render.
    if (Number.isNaN(draftAsNumber) || draftAsNumber !== value) {
      setDraft(value === 0 && blankWhenZero ? "" : String(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, blankWhenZero]);

  return (
    <Input
      id={id}
      type="number"
      min={min}
      step={step}
      placeholder={placeholder}
      readOnly={readOnly}
      value={draft}
      onChange={(e) => {
        if (readOnly) return;

        const raw = e.target.value;
        setDraft(raw);

        const parsed = Number(raw);
        onChange(raw === "" || Number.isNaN(parsed) ? 0 : parsed);
      }}
    />
  );
}
