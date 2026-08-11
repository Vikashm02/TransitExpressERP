"use client";

import { useEffect, useRef, useState } from "react";

import FormField from "@/components/ui/FormField";
import { Button } from "@/components/ui/button";

interface DigitalSignaturePadProps {
  /** Existing `digitalSignatureUrl`, if one was already saved — loaded
   * into the canvas on mount so a returning user sees their signature. */
  value: string;
  saving: boolean;
  onSave: (file: File) => void;
}

/**
 * A draw-with-mouse-or-touch signature pad, built on the plain HTML5
 * Canvas + Pointer Events APIs already available in the browser — no
 * signature-pad library is added, since the project doesn't already
 * have one installed. Pointer Events unify mouse/touch/pen handling in
 * a single set of handlers.
 */
export default function DigitalSignaturePad({ value, saving, onSave }: DigitalSignaturePadProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [isDirty, setIsDirty] = useState(false);

  // Size the canvas's pixel buffer to match its displayed box exactly,
  // once on mount, so drawing coordinates line up 1:1 (no CSS-stretch
  // distortion) — then restore the previously saved signature (if any)
  // into that freshly sized surface, satisfying "load the saved
  // signature when company info is loaded again".
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    if (value) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        canvasRef.current?.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = value;
    }
    // Intentionally mount-only: re-running on every `value` change would
    // wipe an in-progress drawing whenever the parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    drawingRef.current = true;
    const { x, y } = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    e.preventDefault();
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    const { x, y } = pointFromEvent(e);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1f2937";
    ctx.lineTo(x, y);
    ctx.stroke();
    setIsDirty(true);
    e.preventDefault();
  }

  function stopDrawing(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    e.preventDefault();
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // Only wipes this drawing surface — no other Company Master field
    // is touched, and nothing is persisted until Save Signature (and
    // then Save Company) is clicked.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setIsDirty(true);
  }

  function handleSave() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.toBlob((blob) => {
      if (!blob) return;
      onSave(new File([blob], "digital-signature.png", { type: "image/png" }));
      setIsDirty(false);
    }, "image/png");
  }

  return (
    <FormField
      label="Digital Signature"
      htmlFor="company-digital-signature"
      hint="Draw with mouse or touch, then Save Signature. Save Company below persists it with the company record."
    >
      <div className="space-y-3">
        <div
          ref={containerRef}
          className="h-40 w-full max-w-md overflow-hidden rounded-lg border bg-white"
        >
          <canvas
            id="company-digital-signature"
            ref={canvasRef}
            className="h-full w-full touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDrawing}
            onPointerLeave={stopDrawing}
          />
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClear}
          >
            Clear
          </Button>

          <Button
            type="button"
            size="sm"
            disabled={!isDirty || saving}
            onClick={handleSave}
          >
            {saving ? "Saving..." : "Save Signature"}
          </Button>
        </div>
      </div>
    </FormField>
  );
}
