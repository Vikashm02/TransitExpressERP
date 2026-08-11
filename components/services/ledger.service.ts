import { getBillingParty, type BillingPartyRecord } from "./billingParty.service";
import { getBills } from "./billing.service";
import { getCreditNotes } from "./creditNote.service";

// Formatted per-entry strings — e.g. "Bill / ZIGMA-BILL-001" or
// "Credit Received / ZIGMA-CN-001" — not a fixed set of literals, since
// each one embeds the actual Bill/Credit Note number.
export type LedgerParticulars = string;

export interface LedgerEntry {
  date: string;
  particulars: LedgerParticulars;
  reference: string;
  debit: number;
  credit: number;
}

export interface LedgerRow extends LedgerEntry {
  runningBalance: number;
}

export interface LedgerStatement {
  billingParty: BillingPartyRecord;
  fromDate: string;
  toDate: string;
  openingBalance: number;
  rows: LedgerRow[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}

function withinRange(date: string, fromDate: string, toDate: string): boolean {
  return date >= fromDate && date <= toDate;
}

/**
 * Builds a Billing Party statement for a date range from the normal
 * Bill → Payment cycle: Bills and Credit Notes only. Reads through the
 * existing `billing.service.ts` / `creditNote.service.ts` /
 * `billingParty.service.ts` exports only (no direct table access, no
 * duplicated master data, and none of those files are modified) —
 * LR/POD operational records are never touched or surfaced here.
 *
 * Accounting direction (approved business rule): an issued Bill is the
 * Debit against the party. A Credit Note's `amount` ("Total Amount
 * Received") is the literal cash received from the party and is the
 * whole Credit — its `deduction` is preserved on the Credit Note record
 * for reference/reconciliation only and is never subtracted again here
 * and never becomes a separate Ledger row, because a deduction is not
 * money received. Debit Notes are intentionally excluded from this
 * aggregation entirely (see debitNote.service.ts / DebitNoteListPage.tsx,
 * which remain a fully standalone module) — a Bill is already the one
 * and only Debit for its own amount, so layering a Debit Note on top of
 * it would double-count the same debt.
 *
 * No prior accounting history exists anywhere in this system, so the
 * Opening Balance for every statement is always 0 — never invented.
 */
export async function getLedgerStatement(
  billingPartyId: number,
  fromDate: string,
  toDate: string
): Promise<LedgerStatement> {
  const [billingParty, bills, creditNotes] = await Promise.all([
    getBillingParty(billingPartyId),
    getBills(),
    getCreditNotes(),
  ]);

  const entries: LedgerEntry[] = [];

  for (const bill of bills) {
    if (bill.billingPartyId !== billingPartyId) continue;
    if (!withinRange(bill.billDate, fromDate, toDate)) continue;

    entries.push({
      date: bill.billDate,
      particulars: `Bill / ${bill.billNumber}`,
      reference: bill.billNumber,
      debit: bill.grandTotal,
      credit: 0,
    });
  }

  for (const note of creditNotes) {
    if (note.billingPartyId !== billingPartyId) continue;
    if (!withinRange(note.noteDate, fromDate, toDate)) continue;

    // `note.amount` ("Total Amount Received") is the actual cash
    // received — the whole Credit. `note.deduction` is not money
    // received, so it is never added, subtracted, or turned into a
    // second Ledger row here (it stays visible only on the Credit Note
    // record itself).
    entries.push({
      date: note.noteDate,
      particulars: `Credit Received / ${note.creditNoteNumber}`,
      reference: note.creditNoteNumber,
      debit: 0,
      credit: note.amount,
    });
  }

  // Chronological order; a stable reference-based tiebreak keeps same-day
  // entries in a deterministic, repeatable order across renders/prints.
  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.reference.localeCompare(b.reference);
  });

  const openingBalance = 0;
  let runningBalance = openingBalance;

  const rows: LedgerRow[] = entries.map((entry) => {
    runningBalance += entry.debit - entry.credit;
    return { ...entry, runningBalance };
  });

  const totalDebit = entries.reduce((sum, entry) => sum + entry.debit, 0);
  const totalCredit = entries.reduce((sum, entry) => sum + entry.credit, 0);

  return {
    billingParty,
    fromDate,
    toDate,
    openingBalance,
    rows,
    totalDebit,
    totalCredit,
    closingBalance: runningBalance,
  };
}

/**
 * Dashboard-only aggregate: the exact same Bill (Debit) / Credit Note
 * (Credit) accounting rule as `getLedgerStatement` above — a Bill is a
 * Debit, a Credit Note's `amount` is a Credit, Debit Notes are excluded —
 * but summed across ALL Billing Parties instead of one, i.e. "Ledger with
 * Billing Party = All" for a date range. `fromDate`/`toDate` are optional
 * here (unlike the required range on `getLedgerStatement`) so the caller
 * can represent "no lower/upper bound" without inventing a placeholder
 * date. Does not read/modify `getLedgerStatement` or any Ledger UI.
 */
export async function getOverallOutstanding(fromDate?: string, toDate?: string): Promise<number> {
  const [bills, creditNotes] = await Promise.all([getBills(), getCreditNotes()]);

  const inRange = (date: string) => (!fromDate || date >= fromDate) && (!toDate || date <= toDate);

  const totalDebit = bills
    .filter((bill) => inRange(bill.billDate))
    .reduce((sum, bill) => sum + bill.grandTotal, 0);

  const totalCredit = creditNotes
    .filter((note) => inRange(note.noteDate))
    .reduce((sum, note) => sum + note.amount, 0);

  return totalDebit - totalCredit;
}
