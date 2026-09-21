"use client";

import { useCallback, useEffect, useRef } from "react";

interface UseDebouncedAutosaveOptions<T> {
  values: T;
  enabled: boolean;
  delayMs?: number;
  onSave: (values: T) => void | Promise<void>;
}

/**
 * Debounced autosave for draft forms. Does not run on every keystroke.
 * Skips while disabled (e.g. read-only / finalizing).
 *
 * Returns `cancelPending` so explicit Save / Close-flush flows can take
 * over: cancel the pending timer, then persist latest values directly
 * through the caller's own save path (which owns durability).
 */
export function useDebouncedAutosave<T>({
  values,
  enabled,
  delayMs = 2000,
  onSave,
}: UseDebouncedAutosaveOptions<T>): { cancelPending: () => void } {
  const onSaveRef = useRef(onSave);
  const first = useRef(true);
  const timerRef = useRef<number | null>(null);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!enabled) return;
    if (first.current) {
      first.current = false;
      return;
    }

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void onSaveRef.current(values);
    }, delayMs);

    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [values, enabled, delayMs]);

  const cancelPending = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return { cancelPending };
}
