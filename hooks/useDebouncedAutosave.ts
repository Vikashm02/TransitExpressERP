"use client";

import { useEffect, useRef } from "react";

interface UseDebouncedAutosaveOptions<T> {
  values: T;
  enabled: boolean;
  delayMs?: number;
  onSave: (values: T) => void | Promise<void>;
}

/**
 * Debounced autosave for draft forms. Does not run on every keystroke.
 * Skips while disabled (e.g. read-only / finalizing).
 */
export function useDebouncedAutosave<T>({
  values,
  enabled,
  delayMs = 2000,
  onSave,
}: UseDebouncedAutosaveOptions<T>) {
  const onSaveRef = useRef(onSave);
  const first = useRef(true);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!enabled) return;
    if (first.current) {
      first.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      void onSaveRef.current(values);
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [values, enabled, delayMs]);
}
