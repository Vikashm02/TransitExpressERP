/* eslint-disable */
"use client";

import { useEffect, useRef, useState } from "react";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";
import FormDatePicker from "@/components/ui/FormDatePicker";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getActiveLrPurchaseOrders, type PurchaseOrderLookup } from "@/components/services/purchaseOrder.service";
import { getLrBillingPartyLookup } from "@/components/services/billingParty.service";
import { supabase } from "@/lib/supabase";
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
  const [lookup, setLookup] = useState<{ key: string; options: PurchaseOrderLookup[]; failed: boolean; legacyUnresolved?: boolean } | null>(null);
  const lookupKey = `${lr.billingPartyId ?? ""}\u0000${lr.consignorId ?? ""}\u0000${lr.consigneeId ?? ""}\u0000${lr.customer}\u0000${lr.consignor}\u0000${lr.materialId ?? ""}`;
  const hasCustomerText = Boolean(lr.customer && lr.customer.trim());
  const hasConsignorText = Boolean(lr.consignor && lr.consignor.trim());
  const hasMaterial = Boolean(lr.materialId);
  const canResolveLegacy = hasCustomerText && hasConsignorText && hasMaterial;
  const enabled = !readOnly && hasConsignorText && hasMaterial && Boolean(lr.consigneeId) && (Boolean(lr.billingPartyId) || canResolveLegacy);
  const currentLookup = lookup?.key === lookupKey ? lookup : null;
  const options = enabled ? currentLookup?.options ?? [] : [];
  const loading = enabled && !currentLookup;
  const failed = enabled && Boolean(currentLookup?.failed);
  const latest = useRef({ lr, onChange });
  useEffect(() => { latest.current = { lr, onChange }; }, [lr, onChange]);
  const [changeMode, setChangeMode] = useState(false);
  // Reset changeMode when identities change (so stale selection is not shown)
  const prevIdentitiesRef = useRef(lookupKey);
  useEffect(() => {
    if (prevIdentitiesRef.current !== lookupKey) {
      prevIdentitiesRef.current = lookupKey;
      setChangeMode(false);
    }
  }, [lookupKey]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function fetchOptions() {
      try {
        let billingId = lr.billingPartyId;
        if (billingId == null && canResolveLegacy) {
          const parties = await getLrBillingPartyLookup();
          const normalizedCustomer = lr.customer.trim().toUpperCase();
          const matches = parties.filter((p) => p.entryStatus === "final" && p.name.trim().toUpperCase() === normalizedCustomer);
          if (matches.length === 1) billingId = matches[0].id;
          else {
            if (!cancelled) setLookup({ key: lookupKey, options: [], failed: false, legacyUnresolved: true });
            return;
          }
        }
        if (billingId == null) {
          if (!cancelled) setLookup({ key: lookupKey, options: [], failed: false });
          return;
        }
        const rows = await getActiveLrPurchaseOrders(billingId, lr.consignor, lr.consigneeId, lr.materialId);
        if (cancelled) return;
        setLookup({ key: lookupKey, options: rows, failed: false });
        const current = latest.current;
        if (autoSelect && rows.length === 1 && !current.lr.poNumber && !current.lr.purchaseOrderId) {
          const po = rows[0];
          current.onChange({ ...current.lr, purchaseOrderId: po.id, poNumber: po.poNumber, poDate: po.issueDate });
        }
      } catch {
        if (!cancelled) setLookup({ key: lookupKey, options: [], failed: true });
      }
    }
    void fetchOptions();
    return () => { cancelled = true; };
  }, [lr.customer, lr.consignor, lr.billingPartyId, lr.consigneeId, lr.materialId, lookupKey, enabled, autoSelect, canResolveLegacy]);

  const hint = readOnly ? undefined : loading ? "Loading active POs..." : failed ? "PO lookup unavailable. Existing PO details are preserved."
    : options.length > 1 ? "Multiple active POs found. Choose the correct PO."
    : !options.length && lr.customer && lr.consignor && lr.consigneeId ? "No active PO found for this Billing Party, Consignor, Consignee and Material." : undefined;
  const selectedIsActive = options.some((p) => p.id === lr.purchaseOrderId);
  const selectedPO = options.find((p) => p.id === lr.purchaseOrderId);
  const poMasterDiffers = selectedPO && (selectedPO.poNumber !== lr.poNumber || selectedPO.issueDate !== lr.poDate);
  const legacyUnresolved = enabled && Boolean(currentLookup?.legacyUnresolved);
  const lookupSucceeded = currentLookup !== null && !currentLookup.failed && !currentLookup.legacyUnresolved;
  // Actual current PO status, not inferred from absence in Active matching options.
  // Bind status to the PO ID it was fetched for to avoid stale Inactive from PO 8 being applied to PO 21.
  const [statusResult, setStatusResult] = useState<{ purchaseOrderId: number; status: string | null } | null>(null);
  useEffect(() => {
    if (!lr.purchaseOrderId) {
      setStatusResult(null);
      return;
    }
    const pid = lr.purchaseOrderId;
    let cancelled = false;
    supabase
      .from("purchase_orders")
      .select("status")
      .eq("id", pid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) setStatusResult({ purchaseOrderId: pid, status: null });
        else setStatusResult({ purchaseOrderId: pid, status: String((data as { status?: unknown }).status ?? "") });
      });
    return () => { cancelled = true; };
  }, [lr.purchaseOrderId]);
  const isCurrentPOActuallyInactive = statusResult?.purchaseOrderId === lr.purchaseOrderId && statusResult?.status === "Inactive";
  const isStatusUnknown = !statusResult || statusResult.purchaseOrderId !== lr.purchaseOrderId || statusResult.status == null;
  // Stabilise replacement availability against unsaved identity edits: replacement RPC uses
  // the persisted LR row, not form values, so disable when Billing Party / Consignor / Consignee / Material
  // have unsaved changes to avoid misleading operation.
  const [initialIdentities, setInitialIdentities] = useState<{ billingPartyId: number | null; consignor: string; consigneeId: number | null; materialId: number | null } | null>(null);
  useEffect(() => {
    if (initialIdentities === null && lr.customer && lr.consignor && lr.consigneeId && lr.materialId) {
      setInitialIdentities({
        billingPartyId: lr.billingPartyId ?? null,
        consignor: lr.consignor,
        consigneeId: lr.consigneeId ?? null,
        materialId: lr.materialId ?? null,
      });
    }
  }, [lr.customer, lr.consignor, lr.consigneeId, lr.materialId, lr.billingPartyId, initialIdentities]);
  const hasUnsavedIdentityChanges =
    initialIdentities !== null &&
    (
      initialIdentities.billingPartyId !== (lr.billingPartyId ?? null) ||
      initialIdentities.consignor !== lr.consignor ||
      initialIdentities.consigneeId !== (lr.consigneeId ?? null) ||
      initialIdentities.materialId !== (lr.materialId ?? null)
    );
  // Known Inactive -> offer. Unknown status (no purchase_orders/view) + successful Active lookup where current PO is absent → preserve candidate, RPC remains final authority.
  const canOfferReplacementKnownInactive = isCurrentPOActuallyInactive && !hasUnsavedIdentityChanges;
  const canOfferReplacementFallback =
    isStatusUnknown && lookupSucceeded && !hasUnsavedIdentityChanges && !selectedIsActive && Boolean(lr.purchaseOrderId) && !legacyUnresolved;
  const canOfferReplacement =
    !readOnly &&
    Boolean(onCreateReplacementPo) &&
    Boolean(lr.purchaseOrderId) &&
    !loading &&
    !failed &&
    !legacyUnresolved &&
    options.length === 0 &&
    (canOfferReplacementKnownInactive || canOfferReplacementFallback);
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

  const showCurrentPO = Boolean(lr.purchaseOrderId || lr.poNumber);
  // Never display "Inactive" unless the actual PO row is known to be Inactive.
  // Absence from matching Active options (e.g. after identity edits, lookup failure,
  // legacy unresolved) is not evidence of Inactive.
  const currentPOStatus = selectedIsActive ? "Active" : isCurrentPOActuallyInactive ? "Inactive" : "";

  return <>
    {showCurrentPO && !readOnly ? (
      <div className="md:col-span-2 xl:col-span-3 rounded-md border bg-muted/20 px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <span className="font-medium">Current PO:</span>{" "}
            {lr.poNumber ? `${lr.poNumber}` : "—"}
            {lr.poDate ? ` · ${lr.poDate}` : ""}
            {currentPOStatus ? ` — ${currentPOStatus}` : ""}
          </span>
          {!changeMode && options.length > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setChangeMode(true)} disabled={loading}>
              Change PO
            </Button>
          ) : null}
          {!changeMode && canOfferReplacement && options.length === 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setChangeMode(true)} disabled={loading}>
              Change PO
            </Button>
          ) : null}
        </div>
        {changeMode && options.length === 0 && !loading && !failed ? (
          <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    ) : null}
    {(changeMode || (!readOnly && options.length > 0 && !showCurrentPO)) ? (
      <FormSelect label={showCurrentPO ? "Select Active PO" : "Active PO"} id="lr-active-po"
        value={selectedIsActive ? String(lr.purchaseOrderId) : ""}
        options={options.map((p) => ({ value: String(p.id), label: `${p.poNumber} · ${p.issueDate}` }))}
        hint={hint} placeholder="Choose active PO" disabled={loading}
        onValueChange={(id) => {
          const po = options.find((p) => p.id === Number(id));
          if (po && po.id !== lr.purchaseOrderId) {
            onChange({ ...lr, purchaseOrderId: po.id, poNumber: po.poNumber, poDate: po.issueDate });
            setChangeMode(false);
          }
        }} />
    ) : null}
    {changeMode ? (
      <div className="md:col-span-2 xl:col-span-3 flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setChangeMode(false)}>Cancel change</Button>
      </div>
    ) : null}
    {poMasterDiffers && !readOnly && lr.purchaseOrderId && !changeMode && (
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
    <FormField label="PO Number" htmlFor="lr-po-number" hint={!changeMode && options.length ? undefined : hint}>
      <Input id="lr-po-number" value={lr.poNumber} placeholder="PO Number"
        readOnly={readOnly || Boolean(lr.purchaseOrderId) || options.length > 0}
        onChange={(e) => onChange({ ...lr, poNumber: e.target.value })} />
    </FormField>
    <FormDatePicker label="PO Date" id="lr-po-date" value={lr.poDate ?? ""}
      disabled={readOnly || Boolean(lr.purchaseOrderId) || options.length > 0}
      onChange={(poDate) => onChange({ ...lr, poDate })} />

    {canOfferReplacement && !replacementMode && !changeMode ? (
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
