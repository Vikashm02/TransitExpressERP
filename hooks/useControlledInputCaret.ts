"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Restores selection on a controlled <input> after React commits a reformatted
 * value. requestAnimationFrame alone is too early — React replaces the DOM
 * value afterward and resets the caret to the end.
 */
export function useControlledInputCaret(
  inputRef: RefObject<HTMLInputElement | null>,
  value: string
) {
  const pendingCaretRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const caret = pendingCaretRef.current;
    if (caret === null) return;
    pendingCaretRef.current = null;

    const input = inputRef.current;
    if (!input) return;

    const pos = Math.max(0, Math.min(caret, input.value.length));
    input.setSelectionRange(pos, pos);
  }, [value, inputRef]);

  return function scheduleCaret(position: number) {
    pendingCaretRef.current = position;
  };
}
