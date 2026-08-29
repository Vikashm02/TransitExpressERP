"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getLRs, type LRRecord } from "@/components/services/lr.service";
import { normalizeVehicleNumberKey } from "@/lib/vehicleNumber";

interface FinancialsLrAutocompleteProps {
  id?: string;
  selectedLR: LRRecord | null;
  onSelect: (lr: LRRecord) => void;
  /** Called when the user edits the query away from the selected LR. */
  onClearSelection?: () => void;
  disabled?: boolean;
  className?: string;
}

function lrNumericDigits(lrNumber: string): string {
  return String(lrNumber ?? "").replace(/\D/g, "");
}

/**
 * Financials LR match:
 * - Digits in the query match the numeric portion of LR number (any length).
 * - Exactly 4 digits also match vehicle numbers ending in those digits.
 */
export function matchesFinancialsLrQuery(lr: LRRecord, rawQuery: string): boolean {
  const query = rawQuery.trim();
  if (!query) return false;

  const qDigits = query.replace(/\D/g, "");
  if (!qDigits) return false;

  const lrDigits = lrNumericDigits(lr.lrNumber);
  if (lrDigits.includes(qDigits)) return true;

  // Vehicle search: last 4 digits only (exact 4-digit typed query).
  if (/^\d{4}$/.test(query)) {
    const vKey = normalizeVehicleNumberKey(lr.vehicleNumber ?? "");
    if (vKey.endsWith(query)) return true;
  }

  return false;
}

/**
 * Inline LR autocomplete for Financials → Add Financials only.
 * Replaces the Search-button + LRLookup dialog step for create mode.
 */
export default function FinancialsLrAutocomplete({
  id,
  selectedLR,
  onSelect,
  onClearSelection,
  disabled,
  className,
}: FinancialsLrAutocompleteProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(selectedLR?.lrNumber ?? "");
  const [listOpen, setListOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lrs, setLrs] = useState<LRRecord[]>([]);
  const [highlight, setHighlight] = useState(0);
  const loadedRef = useRef(false);

  useEffect(() => {
    setQuery(selectedLR?.lrNumber ?? "");
  }, [selectedLR?.id, selectedLR?.lrNumber]);

  useEffect(() => {
    if (disabled || loadedRef.current) return;

    let cancelled = false;
    setLoading(true);
    getLRs()
      .then((data) => {
        if (!cancelled) {
          setLrs(data);
          loadedRef.current = true;
        }
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [disabled]);

  const suggestions = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    // Avoid listing everything when the input already shows a selected LR number
    // and the user has not started a new search.
    if (selectedLR && q === selectedLR.lrNumber.trim()) return [];
    return lrs.filter((lr) => matchesFinancialsLrQuery(lr, q));
  }, [lrs, query, selectedLR]);

  useEffect(() => {
    setHighlight(0);
  }, [suggestions]);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setListOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const showList = listOpen && !disabled && query.trim().length > 0;

  function commit(lr: LRRecord) {
    setQuery(lr.lrNumber);
    setListOpen(false);
    onSelect(lr);
  }

  function handleQueryChange(next: string) {
    setQuery(next);
    setListOpen(true);
    if (selectedLR && next.trim() !== selectedLR.lrNumber.trim()) {
      onClearSelection?.();
    }
  }

  return (
    <div ref={rootRef} className={cn("relative z-30 w-full min-w-0", className)}>
      <Input
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        disabled={disabled}
        placeholder="Type LR number or last 4 digits of vehicle"
        value={query}
        autoComplete="off"
        onFocus={() => setListOpen(true)}
        onChange={(e) => handleQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) =>
              Math.min(h + 1, Math.max(suggestions.length - 1, 0))
            );
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
            setListOpen(false);
          }
        }}
      />

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full left-0 z-50 mt-1 max-h-72 w-full overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {loading && lrs.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              Loading LRs…
            </li>
          ) : suggestions.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              No matching LRs. Try the LR number digits or the last 4 digits of
              the vehicle number.
            </li>
          ) : (
            suggestions.map((lr, index) => (
              <li key={lr.id} role="option" aria-selected={index === highlight}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-md px-3 py-2.5 text-left text-sm touch-manipulation",
                    index === highlight
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/70"
                  )}
                  onMouseEnter={() => setHighlight(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(lr)}
                >
                  <span className="font-medium">{lr.lrNumber}</span>
                  <span className="text-xs text-muted-foreground">
                    Consignor: {lr.consignor || "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Consignee: {lr.consignee || "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Vehicle: {lr.vehicleNumber || "—"}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
