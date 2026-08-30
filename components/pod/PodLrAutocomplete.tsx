"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { matchesFinancialsLrQuery } from "@/components/lorryExpense/FinancialsLrAutocomplete";
import { getLRs, type LRRecord } from "@/components/services/lr.service";
import { getPods } from "@/components/services/pod.service";

interface PodLrAutocompleteProps {
  id?: string;
  selectedLR: LRRecord | null;
  onSelect: (lr: LRRecord) => void;
  onClearSelection?: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Add POD LR autocomplete (Financials match pattern):
 * - Digits match the numeric portion of LR number (prefix "LR" not required).
 * - Exactly 4 digits also match vehicle last-4.
 * - LRs that already have a POD are excluded (eligibility from live POD rows).
 */
export default function PodLrAutocomplete({
  id,
  selectedLR,
  onSelect,
  onClearSelection,
  disabled,
  className,
}: PodLrAutocompleteProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(selectedLR?.lrNumber ?? "");
  const [listOpen, setListOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [eligibleLrs, setEligibleLrs] = useState<LRRecord[]>([]);
  const [highlight, setHighlight] = useState(0);
  const loadedRef = useRef(false);

  useEffect(() => {
    setQuery(selectedLR?.lrNumber ?? "");
  }, [selectedLR?.id, selectedLR?.lrNumber]);

  useEffect(() => {
    if (disabled || loadedRef.current) return;

    let cancelled = false;
    setLoading(true);

    Promise.all([getLRs(), getPods()])
      .then(([lrs, pods]) => {
        if (cancelled) return;
        const taken = new Set(
          pods.map((p) => p.lrNumber.trim().toLowerCase()).filter(Boolean)
        );
        setEligibleLrs(
          lrs.filter((lr) => !taken.has(lr.lrNumber.trim().toLowerCase()))
        );
        loadedRef.current = true;
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
    if (selectedLR && q === selectedLR.lrNumber.trim()) return [];
    return eligibleLrs.filter((lr) => matchesFinancialsLrQuery(lr, q));
  }, [eligibleLrs, query, selectedLR]);

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
          {loading && eligibleLrs.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              Loading LRs…
            </li>
          ) : suggestions.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              No eligible LR found. LRs that already have a POD are hidden.
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
