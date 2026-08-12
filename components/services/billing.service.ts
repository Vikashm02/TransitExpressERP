import { supabase } from "@/lib/supabase";
import type { Bill } from "@/components/billing/billing.schema";
import { getBillingParty, type BillingPartyRecord } from "./billingParty.service";
import { getLRs, updateLR, type LRRecord } from "./lr.service";
import { getPods } from "./pod.service";

const BILLS_TABLE = "bills";
const BILL_LRS_TABLE = "bill_lrs";

export interface BillLineInput {
  /** `lrs.id` is `uuid` live (not `bigint`) — an LR primary-key string. */
  lrId: string;
  weight: number;
  rate: number;
  freight: number;
}

export interface BillLineRecord extends BillLineInput {
  id: number;
  billId: number;
  /** Resolved from `lr.service.ts` (never duplicated into `bill_lrs`). */
  lr: LRRecord | null;
}

/** A persisted Bill row, with `billingPartyName`/`lrCount` resolved via a
 * Supabase embedded-resource select rather than stored/duplicated columns. */
export interface BillRecord {
  id: number;
  billNumber: string;
  billDate: string;
  billingPartyId: number;
  billingPartyName: string;
  poNumber: string;
  totalWeight: number;
  totalFreight: number;
  grandTotal: number;
  lrCount: number;
  created_at?: string;
}

export interface BillDetail {
  bill: BillRecord;
  billingParty: BillingPartyRecord | null;
  lines: BillLineRecord[];
}

interface BillRow {
  id: number;
  bill_number: string;
  bill_date: string;
  billing_party_id: number;
  po_number: string;
  total_weight: number;
  total_freight: number;
  grand_total: number;
  created_at?: string;
  billing_parties?: { name: string } | { name: string }[] | null;
  bill_lrs?: { count: number }[] | null;
}

function fromRow(row: BillRow): BillRecord {
  const billingPartiesValue = row.billing_parties;
  const billingPartyName = Array.isArray(billingPartiesValue)
    ? billingPartiesValue[0]?.name ?? ""
    : billingPartiesValue?.name ?? "";

  return {
    id: row.id,
    billNumber: row.bill_number,
    billDate: row.bill_date,
    billingPartyId: row.billing_party_id,
    billingPartyName,
    poNumber: row.po_number,
    totalWeight: row.total_weight,
    totalFreight: row.total_freight,
    grandTotal: row.grand_total,
    lrCount: row.bill_lrs?.[0]?.count ?? 0,
    created_at: row.created_at,
  };
}

/* ==========================================================
   GET ALL BILLS
========================================================== */

export async function getBills(): Promise<BillRecord[]> {
  const { data, error } = await supabase
    .from(BILLS_TABLE)
    .select("*, billing_parties(name), bill_lrs(count)")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => fromRow(row as unknown as BillRow));
}

/* ==========================================================
   GET ONE BILL (with its LR lines, for View/Print)
========================================================== */

export async function getBill(id: number): Promise<BillDetail> {
  const { data: billRow, error: billError } = await supabase
    .from(BILLS_TABLE)
    .select("*, billing_parties(name), bill_lrs(count)")
    .eq("id", id)
    .single();

  if (billError) throw billError;

  const bill = fromRow(billRow as unknown as BillRow);

  const [linesResult, billingParty, lrs] = await Promise.all([
    supabase.from(BILL_LRS_TABLE).select("*").eq("bill_id", id),
    getBillingParty(bill.billingPartyId).catch(() => null),
    getLRs(),
  ]);

  if (linesResult.error) throw linesResult.error;

  // Every LR referenced by a Bill line is resolved live from `lr.service.ts`
  // here — never duplicated into `bill_lrs`, matching the same "resolve,
  // don't duplicate" pattern `pod.service.ts` uses for Consignee/etc.
  // `LRRecord.id` is declared `number` (a pre-existing, unrelated mismatch
  // in lr.service.ts) but is actually the `uuid` string `lrs.id` at
  // runtime — `String(...)` here is a no-op on that real value, just a
  // type-safe way to key this Billing-local map by string.
  const lrById = new Map(lrs.map((lr) => [String(lr.id), lr]));

  const lines: BillLineRecord[] = (linesResult.data ?? []).map((row) => ({
    id: row.id as number,
    billId: row.bill_id as number,
    lrId: row.lr_id as string,
    weight: row.weight as number,
    rate: row.rate as number,
    freight: row.freight as number,
    lr: lrById.get(row.lr_id as string) ?? null,
  }));

  return { bill, billingParty, lines };
}

/* ==========================================================
   UPDATE BILL (Bill Date / PO Number only — a generated Bill is a
   frozen financial document; `bill_lrs`, `bill_number`, and every
   total/amount derived from them are never touched here)
========================================================== */

export interface BillUpdateInput {
  billDate: string;
  poNumber: string;
}

export async function updateBill(id: number, values: BillUpdateInput): Promise<BillRecord> {
  const { data, error } = await supabase
    .from(BILLS_TABLE)
    .update({
      bill_date: values.billDate,
      po_number: values.poNumber,
    })
    .eq("id", id)
    .select("*, billing_parties(name), bill_lrs(count)")
    .single();

  if (error) throw error;

  return fromRow(data as unknown as BillRow);
}

/* ==========================================================
   CREATE BILL (Bill row + its LR lines)
========================================================== */

/**
 * Creates a Bill and its LR lines together. Supabase's JS client has no
 * multi-statement transaction, so if the line insert fails after the bill
 * row was created, the bill row is deleted again as a best-effort
 * compensating rollback — a Bill with zero LR lines must never persist.
 */
export async function createBill(values: Bill, lines: BillLineInput[]): Promise<BillRecord> {
  const totalWeight = lines.reduce((sum, line) => sum + line.weight, 0);
  const totalFreight = lines.reduce((sum, line) => sum + line.freight, 0);

  const { data: billRow, error: billError } = await supabase
    .from(BILLS_TABLE)
    .insert({
      bill_number: values.billNumber,
      bill_date: values.billDate,
      billing_party_id: values.billingPartyId,
      po_number: values.poNumber,
      total_weight: totalWeight,
      total_freight: totalFreight,
      // GST is payable by the Billing Party (reverse charge) — Grand
      // Total never adds GST on top of Total Freight, per the reference.
      grand_total: totalFreight,
    })
    .select()
    .single();

  if (billError) throw billError;

  const billId = billRow.id as number;

  const { error: linesError } = await supabase.from(BILL_LRS_TABLE).insert(
    lines.map((line) => ({
      bill_id: billId,
      lr_id: line.lrId,
      weight: line.weight,
      rate: line.rate,
      freight: line.freight,
    }))
  );

  if (linesError) {
    await supabase.from(BILLS_TABLE).delete().eq("id", billId);
    throw linesError;
  }

  return fromRow({ ...(billRow as BillRow), bill_lrs: [{ count: lines.length }] });
}

/* ==========================================================
   DELETE BILL
   Deletes the Bill row; `bill_lrs` cascade-delete with their parent
   (migration 014 `on delete cascade`).

   Associated LRs were marked `"Billed"` at Bill creation time
   (BillingListPage / BillingBulkUploadDialog). Status is workflow-
   controlled (RemarksSection.tsx): New LR → Open, POD saved →
   Delivered, Billing → Billed. After the Bill is removed, each LR that
   still shows `"Billed"` is restored to the only status the workflow
   would have left it in without this Bill:
     - `"Delivered"` if a POD exists for that LR
     - `"Open"` otherwise
   No other LR fields are touched. LRs that do not belong to this Bill
   are never modified.
========================================================== */

export async function deleteBill(id: number): Promise<void> {
  // Capture this Bill's LR links before the cascade removes them.
  const { data: lines, error: linesError } = await supabase
    .from(BILL_LRS_TABLE)
    .select("lr_id")
    .eq("bill_id", id);

  if (linesError) throw linesError;

  const lrIds = (lines ?? []).map((row) => String(row.lr_id));

  const { error } = await supabase.from(BILLS_TABLE).delete().eq("id", id);

  if (error) throw error;

  if (lrIds.length === 0) return;

  const [lrs, pods] = await Promise.all([getLRs(), getPods()]);
  const podLrNumbers = new Set(pods.map((pod) => pod.lrNumber));

  const targets = lrs.filter((lr) => lrIds.includes(String(lr.id)) && lr.status === "Billed");

  await Promise.all(
    targets.map((lr) => {
      const nextStatus = podLrNumbers.has(lr.lrNumber) ? "Delivered" : "Open";
      return updateLR(lr.id, { ...lr, status: nextStatus });
    })
  );
}
