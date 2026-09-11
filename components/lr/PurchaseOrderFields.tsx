"use client";

import { useEffect, useRef, useState } from "react";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";
import FormDatePicker from "@/components/ui/FormDatePicker";
import { Input } from "@/components/ui/input";
import { getActiveLrPurchaseOrders, type PurchaseOrderLookup } from "@/components/services/purchaseOrder.service";
import type { LR } from "./lr.schema";

export default function PurchaseOrderFields({ lr, onChange, readOnly, autoSelect }: {
  lr: LR; onChange: (next: LR) => void; readOnly: boolean; autoSelect: boolean;
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

  return <>
    {!readOnly && options.length > 0 ? <FormSelect label="Active PO" id="lr-active-po"
      value={selectedIsActive ? String(lr.purchaseOrderId) : ""}
      options={options.map((p) => ({ value: String(p.id), label: `${p.poNumber} · ${p.issueDate}` }))}
      hint={hint} placeholder="Choose active PO" disabled={loading}
      onValueChange={(id) => {
        const po = options.find((p) => p.id === Number(id));
        if (po) onChange({ ...lr, purchaseOrderId: po.id, poNumber: po.poNumber, poDate: po.issueDate });
      }} /> : null}
    <FormField label="PO Number" htmlFor="lr-po-number" hint={options.length ? undefined : hint}>
      <Input id="lr-po-number" value={lr.poNumber} placeholder="PO Number"
        readOnly={readOnly || Boolean(lr.purchaseOrderId) || options.length > 0}
        onChange={(e) => onChange({ ...lr, poNumber: e.target.value })} />
    </FormField>
    <FormDatePicker label="PO Date" id="lr-po-date" value={lr.poDate ?? ""}
      disabled={readOnly || Boolean(lr.purchaseOrderId) || options.length > 0}
      onChange={(poDate) => onChange({ ...lr, poDate })} />
  </>;
}
