"use client";

import { useEffect, useRef, useState } from "react";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";
import FormDatePicker from "@/components/ui/FormDatePicker";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getActiveLrPurchaseOrders, type PurchaseOrderLookup } from "@/components/services/purchaseOrder.service";
import type { LR } from "./lr.schema";

export default function PurchaseOrderFields({
  lr,
  onChange,
  readOnly,
  autoSelect,
  onCreateReplacementPo,
  replacementPoSaving = false,
}: {
  lr: LR;
  onChange: (next: LR) => void;
  readOnly: boolean;
  autoSelect: boolean;
  onCreateReplacementPo?: (poNumber: string, issueDate: string) => Promise<void>;
  replacementPoSaving?: boolean;
}) {
  const [lookup, setLookup] = useState<{ key: string; options: PurchaseOrderLookup[]; failed: boolean } | null>(null);
  const lookupKey = `${lr.customer}\u0000${lr.consignor}`;
  const enabled = !readOnly && Boolean(lr.customer.trim() && lr.consignor.trim());
  const currentLookup = lookup?.key === lookupKey ? lookup : null;
  const options = enabled ? currentLookup?.options ?? [] : [];
  const loading = enabled && !currentLookup;
  const failed = enabled && Boolean(currentLookup?.failed);
  const latest = useRef({ lr, onChange });
  useEffect(() => { latest.current = { lr, onChange }; }, [lr, onChange]);

  useEffect(() => {
    if (readOnly || !lr.customer.trim() || !lr.consignor.trim()) return;
    let cancelled = false;
    getActiveLrPurchaseOrders(lr.customer, lr.consignor).then((rows) => {
      if (cancelled) return;
      setLookup({ key: lookupKey, options: rows, failed: false });
      const current = latest.current;
      // Never replace a stored PO just because a historical LR was opened.
      if (autoSelect && rows.length === 1 && !current.lr.poNumber && !current.lr.purchaseOrderId) {
        const po = rows[0];
        current.onChange({ ...current.lr, purchaseOrderId: po.id, poNumber: po.poNumber, poDate: po.issueDate });
      }
    }).catch(() => { if (!cancelled) setLookup({ key: lookupKey, options: [], failed: true }); });
    return () => { cancelled = true; };
  }, [lr.customer, lr.consignor, lookupKey, readOnly, autoSelect]);

  const hint = readOnly ? undefined : loading ? "Loading active POs..." : failed ? "PO lookup unavailable. Existing PO details are preserved."
    : options.length > 1 ? "Multiple active POs found. Choose the correct PO."
    : !options.length && lr.customer && lr.consignor ? "No active PO found for this Billing Party and Consignor." : undefined;
  const selectedIsActive = options.some((p) => p.id === lr.purchaseOrderId);
  const selectedPO = options.find((p) => p.id === lr.purchaseOrderId);
  const poMasterDiffers = selectedPO && (selectedPO.poNumber !== lr.poNumber || selectedPO.issueDate !== lr.poDate);
  // The lookup intentionally returns only Active POs. The server RPC makes
  // the authoritative Inactive-status decision before creating anything.
  const canOfferReplacement =
    !readOnly &&
    Boolean(onCreateReplacementPo) &&
    Boolean(lr.purchaseOrderId) &&
    !loading &&
    !failed &&
    !selectedIsActive;
  const [replacementForPurchaseOrderId, setReplacementForPurchaseOrderId] = useState<number | null>(null);
  const [replacementPoNumber, setReplacementPoNumber] = useState("");
  const [replacementIssueDate, setReplacementIssueDate] = useState("");
  const [replacementError, setReplacementError] = useState<string | null>(null);
  const replacementMode = replacementForPurchaseOrderId === lr.purchaseOrderId;

  async function createReplacement() {
    const poNumber = replacementPoNumber.trim();
    if (!poNumber || !replacementIssueDate) {
      setReplacementError("Enter the new PO number and issue date.");
      return;
    }
    setReplacementError(null);
    await onCreateReplacementPo?.(poNumber, replacementIssueDate);
  }

  return <>
    {!readOnly && options.length > 0 ? <FormSelect label="Active PO" id="lr-active-po"
      value={selectedIsActive ? String(lr.purchaseOrderId) : ""}
      options={options.map((p) => ({ value: String(p.id), label: `${p.poNumber} · ${p.issueDate}` }))}
      hint={hint} placeholder="Choose active PO" disabled={loading}
      onValueChange={(id) => {
        const po = options.find((p) => p.id === Number(id));
        if (po && po.id !== lr.purchaseOrderId) {
          onChange({ ...lr, purchaseOrderId: po.id, poNumber: po.poNumber, poDate: po.issueDate });
        }
      }} /> : null}
    {poMasterDiffers && !readOnly && lr.purchaseOrderId && (
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          const po = options.find((p) => p.id === lr.purchaseOrderId);
          if (po) onChange({ ...lr, poNumber: po.poNumber, poDate: po.issueDate });
        }}
        className="mt-2 w-full"
      >
        Update from PO Master
      </Button>
    )}
    <FormField label="PO Number" htmlFor="lr-po-number" hint={options.length ? undefined : hint}>
      <Input id="lr-po-number" value={lr.poNumber} placeholder="PO Number"
        readOnly={readOnly || Boolean(lr.purchaseOrderId) || options.length > 0}
        onChange={(e) => onChange({ ...lr, poNumber: e.target.value })} />
    </FormField>
    <FormDatePicker label="PO Date" id="lr-po-date" value={lr.poDate ?? ""}
      disabled={readOnly || Boolean(lr.purchaseOrderId) || options.length > 0}
      onChange={(poDate) => onChange({ ...lr, poDate })} />

    {canOfferReplacement && !replacementMode ? (
      <div className="md:col-span-2 xl:col-span-3">
        <Button
          variant="outline"
          type="button"
          onClick={() => {
            setReplacementForPurchaseOrderId(lr.purchaseOrderId ?? null);
            setReplacementPoNumber("");
            setReplacementIssueDate("");
            setReplacementError(null);
          }}
        >
          Create Replacement PO
        </Button>
      </div>
    ) : null}

    {canOfferReplacement && replacementMode ? (
      <div className="space-y-4 rounded-lg border border-amber-300 bg-amber-50 p-4 md:col-span-2 xl:col-span-3">
        <p className="text-sm text-amber-950">
          Create a new Active PO and link only this LR. The current inactive PO remains unchanged.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="New PO Number" htmlFor="lr-replacement-po-number">
            <Input
              id="lr-replacement-po-number"
              value={replacementPoNumber}
              placeholder="New PO Number"
              disabled={replacementPoSaving}
              onChange={(event) => setReplacementPoNumber(event.target.value)}
            />
          </FormField>
          <FormDatePicker
            label="New PO Issue Date"
            id="lr-replacement-po-date"
            value={replacementIssueDate}
            disabled={replacementPoSaving}
            onChange={setReplacementIssueDate}
          />
        </div>
        {replacementError ? <p className="text-sm text-destructive">{replacementError}</p> : null}
        <div className="flex gap-2">
          <Button type="button" onClick={() => void createReplacement()} disabled={replacementPoSaving}>
            {replacementPoSaving ? "Creating..." : "Create Replacement PO"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={replacementPoSaving}
            onClick={() => {
              setReplacementForPurchaseOrderId(null);
              setReplacementError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    ) : null}
  </>;
}
