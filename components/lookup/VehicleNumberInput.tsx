"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  canonicalizeVehicleNumber,
  formatVehicleNumberInputChange,
  vehicleNumberMatchesQuery,
} from "@/lib/vehicleNumber";
import { useControlledInputCaret } from "@/hooks/useControlledInputCaret";
import type { LrVehicleLookupRow } from "@/components/services/vehicle.service";

interface VehicleNumberInputProps {
  id?: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Vehicles available for typeahead (already loaded by parent). */
  vehicles: LrVehicleLookupRow[];
  loading?: boolean;
  onChange: (vehicleNumber: string) => void;
  /** Fired when the user picks a master row — parent can fill type/hire/etc. */
  onSelectVehicle?: (vehicle: LrVehicleLookupRow) => void;
}

/**
 * Vehicle-number field with live Indian-plate hyphen formatting and
 * typeahead (including last-4-digit search). Free-text entry remains allowed.
 */
export default function VehicleNumberInput({
  id,
  value,
  placeholder = "TN-34MA-8373",
  disabled,
  className,
  vehicles,
  loading = false,
  onChange,
  onSelectVehicle,
}: VehicleNumberInputProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scheduleCaret = useControlledInputCaret(inputRef, value);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const suggestions = useMemo(() => {
    const q = value.trim();
    if (!q) return [];
    return vehicles
      .filter((vehicle) => vehicleNumberMatchesQuery(vehicle.vehicleNumber, q))
      .slice(0, 25);
  }, [vehicles, value]);

  useEffect(() => {
    setHighlight(0);
  }, [suggestions]);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function applyFormattedChange(raw: string, selectionStart: number | null) {
    const cursor = selectionStart ?? raw.length;
    const next = formatVehicleNumberInputChange(raw, cursor, value);
    scheduleCaret(next.cursor);

    // Keep the DOM value/selection in sync before React commits, then
    // useLayoutEffect restores again after the controlled re-render.
    const el = inputRef.current;
    if (el) {
      if (el.value !== next.value) {
        el.value = next.value;
      }
      const pos = Math.min(next.cursor, next.value.length);
      el.setSelectionRange(pos, pos);
    }

    onChange(next.value);
  }

  function commit(vehicle: LrVehicleLookupRow) {
    const number = canonicalizeVehicleNumber(vehicle.vehicleNumber) || vehicle.vehicleNumber;
    onChange(number);
    onSelectVehicle?.(vehicle);
    setOpen(false);
  }

  const showList = open && (loading || value.trim().length > 0);

  return (
    <div ref={rootRef} className={cn("relative w-full min-w-0", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          autoComplete="off"
          className="pl-8"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            applyFormattedChange(e.target.value, e.target.selectionStart);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!showList) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, Math.max(suggestions.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              const option = suggestions[highlight];
              if (option) {
                e.preventDefault();
                commit(option);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          onBlur={() => {
            // Soft-canonicalize completed plates when leaving the field.
            const next = canonicalizeVehicleNumber(value);
            if (next && next !== value) onChange(next);
          }}
        />
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {loading ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">Searching...</li>
          ) : suggestions.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              No matching vehicles. You can keep typing a new number.
            </li>
          ) : (
            suggestions.map((vehicle, index) => {
              const label =
                canonicalizeVehicleNumber(vehicle.vehicleNumber) || vehicle.vehicleNumber;
              return (
                <li key={vehicle.id} role="option" aria-selected={index === highlight}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full flex-col rounded-md px-3 py-2.5 text-left text-sm touch-manipulation",
                      index === highlight ? "bg-accent text-accent-foreground" : "hover:bg-muted/70"
                    )}
                    onMouseEnter={() => setHighlight(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commit(vehicle)}
                  >
                    <span className="font-medium break-all">{label}</span>
                    {(vehicle.vehicleType || vehicle.ownerName) && (
                      <span className="text-xs text-muted-foreground">
                        {[vehicle.vehicleType, vehicle.ownerName].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
