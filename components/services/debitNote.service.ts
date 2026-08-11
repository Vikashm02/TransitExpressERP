import { supabase } from "@/lib/supabase";
import { computeGstAmount } from "@/lib/gstOptions";
import type { DebitNote } from "@/components/debitNote/debitNote.schema";
import type { BillingPartyRecord } from "./billingParty.service";

const TABLE = "debit_notes";

/** A persisted Debit Note row. `totalAmount` (amount + GST, per the
 * approved simple calculation) is derived and stored, mirroring
 * `creditNote.service.ts`'s stored `netAmount`. */
export interface DebitNoteRecord extends DebitNote {
  id: number;
  totalAmount: number;
  gstAmount: number;
  billingPartyName: string;
  created_at?: string;
}

interface DebitNoteRow {
  id: number;
  debit_note_number: string;
  note_date: string;
  billing_party_id: number;
  amount: number;
  gst_percentage: number;
  gst_amount: number;
  total_amount: number;
  remarks: string;
  created_at?: string;
  billing_parties?: { name: string } | { name: string }[] | null;
}

function fromRow(row: DebitNoteRow): DebitNoteRecord {
  const billingPartiesValue = row.billing_parties;
  const billingPartyName = Array.isArray(billingPartiesValue)
    ? billingPartiesValue[0]?.name ?? ""
    : billingPartiesValue?.name ?? "";

  return {
    id: row.id,
    debitNoteNumber: row.debit_note_number,
    noteDate: row.note_date,
    billingPartyId: row.billing_party_id,
    billingPartyName,
    amount: row.amount,
    gstPercentage: row.gst_percentage,
    gstAmount: row.gst_amount,
    totalAmount: row.total_amount,
    remarks: row.remarks,
    created_at: row.created_at,
  };
}

/**
 * Debit Note numbers follow `{Short Code}-DN-{seq}`, independent per
 * Billing Party — counts only that party's existing Debit Notes.
 * Mirrors `generateCreditNoteNumber()` exactly (own independent
 * sequence, same Short Code requirement).
 */
export async function generateDebitNoteNumber(billingParty: BillingPartyRecord): Promise<string> {
  const shortCode = billingParty.shortCode?.trim();

  if (!shortCode) {
    throw new Error(
      `Set a Short Code for "${billingParty.name}" in Billing Party Master before creating a Debit Note.`
    );
  }

  const { count, error } = await supabase
    .from(TABLE)
    .select("*", { count: "exact", head: true })
    .eq("billing_party_id", billingParty.id);

  if (error) throw error;

  const next = (count ?? 0) + 1;
  return `${shortCode.toUpperCase()}-DN-${String(next).padStart(3, "0")}`;
}

/* ==========================================================
   GET ALL DEBIT NOTES
========================================================== */

export async function getDebitNotes(): Promise<DebitNoteRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*, billing_parties(name)")
    .order("note_date", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => fromRow(row as unknown as DebitNoteRow));
}

/* ==========================================================
   GET ONE DEBIT NOTE
========================================================== */

export async function getDebitNote(id: number): Promise<DebitNoteRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*, billing_parties(name)")
    .eq("id", id)
    .single();

  if (error) throw error;

  return fromRow(data as unknown as DebitNoteRow);
}

/* ==========================================================
   CREATE DEBIT NOTE
========================================================== */

export async function createDebitNote(
  values: DebitNote & { debitNoteNumber: string }
): Promise<DebitNoteRecord> {
  const gstAmount = computeGstAmount(values.amount, values.gstPercentage);
  const totalAmount = values.amount + gstAmount;

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      debit_note_number: values.debitNoteNumber,
      note_date: values.noteDate,
      billing_party_id: values.billingPartyId,
      amount: values.amount,
      gst_percentage: values.gstPercentage,
      gst_amount: gstAmount,
      total_amount: totalAmount,
      remarks: values.remarks,
    })
    .select("*, billing_parties(name)")
    .single();

  if (error) throw error;

  return fromRow(data as unknown as DebitNoteRow);
}

/* ==========================================================
   UPDATE DEBIT NOTE
   (Billing Party, Date, Amount, GST, Remarks are editable —
   `debit_note_number` is intentionally frozen and never re-sent here.)
========================================================== */

export async function updateDebitNote(id: number, values: DebitNote): Promise<DebitNoteRecord> {
  const gstAmount = computeGstAmount(values.amount, values.gstPercentage);
  const totalAmount = values.amount + gstAmount;

  const { data, error } = await supabase
    .from(TABLE)
    .update({
      note_date: values.noteDate,
      billing_party_id: values.billingPartyId,
      amount: values.amount,
      gst_percentage: values.gstPercentage,
      gst_amount: gstAmount,
      total_amount: totalAmount,
      remarks: values.remarks,
    })
    .eq("id", id)
    .select("*, billing_parties(name)")
    .single();

  if (error) throw error;

  return fromRow(data as unknown as DebitNoteRow);
}

/* ==========================================================
   DELETE DEBIT NOTE (bulk-upload rollback only)
   The Debit Note module has no Delete action anywhere in its UI
   (DebitNoteListPage only ever Creates/Edits/Views) — this exists
   solely so DebitNoteBulkUploadDialog can perform a compensating
   rollback if an all-or-nothing bulk import fails partway through. It
   is intentionally not exported from/used by any other Debit Note
   screen, mirroring `deleteCreditNote()` in creditNote.service.ts.
========================================================== */

export async function deleteDebitNote(id: number): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) throw error;
}
