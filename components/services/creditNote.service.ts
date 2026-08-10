import { supabase } from "@/lib/supabase";
import { computeGstAmount } from "@/lib/gstOptions";
import type { CreditNote } from "@/components/creditNote/creditNote.schema";
import type { BillingPartyRecord } from "./billingParty.service";

const TABLE = "credit_notes";

/** A persisted Credit Note row. `netAmount`/`gstAmount` are derived and
 * stored (not recomputed on every read) so an edited `amount`/`deduction`
 * always keeps its own snapshot consistent — mirrors how `bills` stores
 * `total_freight`/`grand_total` rather than recomputing them live. */
export interface CreditNoteRecord extends CreditNote {
  id: number;
  netAmount: number;
  gstAmount: number;
  billingPartyName: string;
  created_at?: string;
}

interface CreditNoteRow {
  id: number;
  credit_note_number: string;
  note_date: string;
  billing_party_id: number;
  amount: number;
  deduction: number;
  net_amount: number;
  gst_percentage: number;
  gst_amount: number;
  remarks: string;
  created_at?: string;
  billing_parties?: { name: string } | { name: string }[] | null;
}

function fromRow(row: CreditNoteRow): CreditNoteRecord {
  const billingPartiesValue = row.billing_parties;
  const billingPartyName = Array.isArray(billingPartiesValue)
    ? billingPartiesValue[0]?.name ?? ""
    : billingPartiesValue?.name ?? "";

  return {
    id: row.id,
    creditNoteNumber: row.credit_note_number,
    noteDate: row.note_date,
    billingPartyId: row.billing_party_id,
    billingPartyName,
    amount: row.amount,
    deduction: row.deduction,
    netAmount: row.net_amount,
    gstPercentage: row.gst_percentage,
    gstAmount: row.gst_amount,
    remarks: row.remarks,
    created_at: row.created_at,
  };
}

/**
 * Credit Note numbers follow `{Short Code}-CN-{seq}`, where `seq` is
 * independent per Billing Party — counts only that party's existing
 * Credit Notes, the same count-based pattern already used by
 * `generateBillingPartyCode()` in billingParty.service.ts. Never falls
 * back to the sequential `code` (e.g. "BP001") or an auto-derived
 * name-based prefix — throws instead so the caller can prompt the user
 * to set a Short Code first.
 */
export async function generateCreditNoteNumber(billingParty: BillingPartyRecord): Promise<string> {
  const shortCode = billingParty.shortCode?.trim();

  if (!shortCode) {
    throw new Error(
      `Set a Short Code for "${billingParty.name}" in Billing Party Master before creating a Credit Note.`
    );
  }

  const { count, error } = await supabase
    .from(TABLE)
    .select("*", { count: "exact", head: true })
    .eq("billing_party_id", billingParty.id);

  if (error) throw error;

  const next = (count ?? 0) + 1;
  return `${shortCode.toUpperCase()}-CN-${String(next).padStart(3, "0")}`;
}

/* ==========================================================
   GET ALL CREDIT NOTES
========================================================== */

export async function getCreditNotes(): Promise<CreditNoteRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*, billing_parties(name)")
    .order("note_date", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => fromRow(row as unknown as CreditNoteRow));
}

/* ==========================================================
   GET ONE CREDIT NOTE
========================================================== */

export async function getCreditNote(id: number): Promise<CreditNoteRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*, billing_parties(name)")
    .eq("id", id)
    .single();

  if (error) throw error;

  return fromRow(data as unknown as CreditNoteRow);
}

/* ==========================================================
   CREATE CREDIT NOTE
========================================================== */

export async function createCreditNote(
  values: CreditNote & { creditNoteNumber: string }
): Promise<CreditNoteRecord> {
  // `amount` ("Total Amount Received") IS the actual cash received — the
  // approved business rule is that `deduction` is preserved purely as an
  // informational/reconciliation fact (e.g. against the Bill amount) and
  // must NOT be subtracted again. See ledger.service.ts for the matching
  // Ledger-side rule.
  const netAmount = values.amount;
  const gstAmount = computeGstAmount(values.amount, values.gstPercentage);

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      credit_note_number: values.creditNoteNumber,
      note_date: values.noteDate,
      billing_party_id: values.billingPartyId,
      amount: values.amount,
      deduction: values.deduction,
      net_amount: netAmount,
      gst_percentage: values.gstPercentage,
      gst_amount: gstAmount,
      remarks: values.remarks,
    })
    .select("*, billing_parties(name)")
    .single();

  if (error) throw error;

  return fromRow(data as unknown as CreditNoteRow);
}

/* ==========================================================
   UPDATE CREDIT NOTE
   (Billing Party, Date, Amount, Deduction, GST, Remarks are editable —
   `credit_note_number` is intentionally frozen and never re-sent here,
   even if the Billing Party changes, so an already-issued number never
   silently changes its prefix.)
========================================================== */

export async function updateCreditNote(id: number, values: CreditNote): Promise<CreditNoteRecord> {
  // Same rule as createCreditNote() above — `amount` is the actual cash
  // received; `deduction` is stored but never subtracted from it.
  const netAmount = values.amount;
  const gstAmount = computeGstAmount(values.amount, values.gstPercentage);

  const { data, error } = await supabase
    .from(TABLE)
    .update({
      note_date: values.noteDate,
      billing_party_id: values.billingPartyId,
      amount: values.amount,
      deduction: values.deduction,
      net_amount: netAmount,
      gst_percentage: values.gstPercentage,
      gst_amount: gstAmount,
      remarks: values.remarks,
    })
    .eq("id", id)
    .select("*, billing_parties(name)")
    .single();

  if (error) throw error;

  return fromRow(data as unknown as CreditNoteRow);
}
