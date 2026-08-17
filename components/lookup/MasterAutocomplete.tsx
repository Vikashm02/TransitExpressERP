"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface MasterAutocompleteOption {
  id: string | number;
  label: string;
  description?: string;
  keywords?: string;
}

interface MasterAutocompleteProps {
  id?: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  options: MasterAutocompleteOption[];
  loading?: boolean;
  /** Called with the selected option; never free-text alone. */
  onSelect: (option: MasterAutocompleteOption) => void;
  /** Called when the user types (for debounced remote search if needed). */
  onQueryChange?: (query: string) => void;
  emptyMessage?: string;
  className?: string;
  /** When true, clearing the input notifies parent via onClear. */
  onClear?: () => void;
}

/**
 * Master-only autocomplete: user must pick a matching master row.
 * Typing filters immediately; arbitrary text cannot be committed.
 */
export default function MasterAutocomplete({
  id,
  value,
  placeholder = "Type to search master records...",
  disabled,
  options,
  loading = false,
  onSelect,
  onQueryChange,
  emptyMessage = "No matching master record.",
  className,
  onClear,
}: MasterAutocompleteProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    onQueryChange?.(query);
  }, [query, onQueryChange]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 25);
    return options
      .filter((option) => {
        const hay = `${option.label} ${option.description ?? ""} ${option.keywords ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 25);
  }, [options, query]);

  useEffect(() => {
    setHighlight(0);
  }, [filtered]);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        // Revert uncommitted typing to the last selected master value.
        setQuery(value);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [value]);

  function commit(option: MasterAutocompleteOption) {
    onSelect(option);
    setQuery(option.label);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className={cn("relative w-full", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          placeholder={placeholder}
          value={query}
          autoComplete="off"
          className="pl-8"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            setOpen(true);
            if (!next.trim()) onClear?.();
          }}
          onKeyDown={(e) => {
            if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
              setOpen(true);
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const option = filtered[highlight];
              if (option) commit(option);
            } else if (e.key === "Escape") {
              setOpen(false);
              setQuery(value);
            }
          }}
        />
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {loading ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">Searching...</li>
          ) : filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{emptyMessage}</li>
          ) : (
            filtered.map((option, index) => (
              <li key={option.id} role="option" aria-selected={index === highlight}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full flex-col rounded-md px-3 py-2 text-left text-sm",
                    index === highlight ? "bg-accent text-accent-foreground" : "hover:bg-muted/70"
                  )}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => commit(option)}
                >
                  <span className="font-medium">{option.label}</span>
                  {option.description ? (
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
