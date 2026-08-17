import { differenceInCalendarDays, parseISO } from "date-fns";

import { supabase } from "@/lib/supabase";
import { getBillingParties, type BillingPartyRecord } from "./billingParty.service";
import { getBills } from "./billing.service";
import { getCreditNotes } from "./creditNote.service";
import { getLRs } from "./lr.service";

/* ==========================================================
   REPORT 1 — LR SUMMARY BY BILLING PARTY

   Reuses `lr.service.ts` / `billingParty.service.ts` only — read-only,
   no LR/POD/Billing records are ever modified here. "Billed" reuses the
   LR module's own existing `status === "Billed"` value (see
   lr.schema.ts's LR_STATUS_OPTIONS) rather than inventing a second
   definition; every other status counts as Unbilled.

   `lrs` has no billing_party_id foreign key — an LR's Billing Party is
   stored as the plain name string `lr.customer` (see LRHeader.tsx),
   so parties are matched by exact name here, the only linkage that
   exists between the two tables today.
========================================================== */

export interface LRSummaryRow {
  billingPartyId: number;
  billingPartyName: string;
  totalLRs: number;
  billedLRs: number;
  unbilledLRs: number;
}

export interface LRSummaryReport {
  fromDate: string;
  toDate: string;
  rows: LRSummaryRow[];
  totalLRs: number;
  totalBilled: number;
  totalUnbilled: number;
}

export interface LRSummaryFilters {
  billingPartyId?: number;
  fromDate?: string;
  toDate?: string;
}

export async function getLRSummaryByBillingParty(
  filters: LRSummaryFilters = {}
): Promise<LRSummaryReport> {
  const [billingParties, lrs] = await Promise.all([getBillingParties(), getLRs()]);

  const parties = filters.billingPartyId
    ? billingParties.filter((party) => party.id === filters.billingPartyId)
    : billingParties;

  const rows: LRSummaryRow[] = parties
    .map((party) => {
      const partyLRs = lrs.filter((lr) => {
        if (lr.customer !== party.name) return false;
        if (filters.fromDate && lr.lrDate < filters.fromDate) return false;
        if (filters.toDate && lr.lrDate > filters.toDate) return false;
        return true;
      });

      const billedLRs = partyLRs.filter((lr) => lr.status === "Billed").length;

      return {
        billingPartyId: party.id,
        billingPartyName: party.name,
        totalLRs: partyLRs.length,
        billedLRs,
        unbilledLRs: partyLRs.length - billedLRs,
      };
    })
    .sort((a, b) => a.billingPartyName.localeCompare(b.billingPartyName));

  return {
    fromDate: filters.fromDate ?? "",
    toDate: filters.toDate ?? "",
    rows,
    totalLRs: rows.reduce((sum, row) => sum + row.totalLRs, 0),
    totalBilled: rows.reduce((sum, row) => sum + row.billedLRs, 0),
    totalUnbilled: rows.reduce((sum, row) => sum + row.unbilledLRs, 0),
  };
}

/* ==========================================================
   REPORT 2 — OUTSTANDING PAYMENT BY BILLING PARTY (AGING)

   Approved accounting model (unchanged from ledger.service.ts, never
   duplicated as a second source of truth — this reads the same
   `billing.service.ts` / `creditNote.service.ts` records, just grouped
   and aged differently for this report):
     Bill = Debit. Credit Note `amount` (Total Amount Received) = Credit,
     used in full. Debit Notes are excluded entirely. Discount/Deduction
     is informational only and never enters this calculation.

   Aging/FIFO rule (approved): a Billing Party's outstanding balance is
   not "last payment vs today" — it is bucketed per *Bill*, because
   partial/multiple payments must be allocated across possibly many
   Bills. This performs that allocation at read time only:
     1. Take that party's Bills with billDate <= asOfDate, oldest first.
     2. Sum that party's Credit Note `amount` with noteDate <= asOfDate
        into one payment pool (no Bill-to-CreditNote link exists in the
        database, and none is created here — see migration notes).
     3. Walk the Bills oldest-first, applying the pool to each Bill's
        `grandTotal` until the pool is exhausted. Each Bill's leftover
        (grandTotal minus what was applied to it) is that Bill's
        outstanding amount — it is never "reset" by a later payment.
     4. Each Bill's outstanding amount is aged from its own `billDate`
        to `asOfDate` into 0-30 / 31-60 / 60+ buckets, and marked
        overdue when `asOfDate` is past `billDate + paymentCycleDays`.
   This is a report-only calculation — it never writes to `bills` or
   `credit_notes`, and creates no allocation records.
========================================================== */

export type AgingBucket = "0-30" | "31-60" | "60+";
export type PaymentStatus = "No Outstanding" | "Within Cycle" | "Overdue";

export interface OutstandingRow {
  billingPartyId: number;
  billingPartyName: string;
  paymentCycleDays: number;
  totalOutstanding: number;
  bucket0To30: number;
  bucket31To60: number;
  bucket60Plus: number;
  overdueAmount: number;
  paymentStatus: PaymentStatus;
}

export interface OutstandingReport {
  asOfDate: string;
  rows: OutstandingRow[];
  totalOutstanding: number;
  totalBucket0To30: number;
  totalBucket31To60: number;
  totalBucket60Plus: number;
  totalOverdue: number;
}

export interface OutstandingFilters {
  billingPartyId?: number;
}

function ageBucket(ageDays: number): AgingBucket {
  if (ageDays <= 30) return "0-30";
  if (ageDays <= 60) return "31-60";
  return "60+";
}

function buildOutstandingRow(
  party: BillingPartyRecord,
  partyBills: { billNumber: string; billDate: string; grandTotal: number }[],
  totalPayments: number,
  asOfDate: string
): OutstandingRow {
  const sortedBills = [...partyBills].sort((a, b) =>
    a.billDate === b.billDate ? a.billNumber.localeCompare(b.billNumber) : a.billDate < b.billDate ? -1 : 1
  );

  const asOf = parseISO(asOfDate);
  const paymentCycleDays = party.paymentCycleDays ?? 0;

  let remainingPayment = totalPayments;
  let bucket0To30 = 0;
  let bucket31To60 = 0;
  let bucket60Plus = 0;
  let overdueAmount = 0;

  for (const bill of sortedBills) {
    // FIFO: the pool is applied to the oldest Bill first; whatever is
    // left over is that Bill's own outstanding amount, permanently tied
    // to its own `billDate` — a later payment against a newer Bill can
    // never "un-age" this one.
    const applied = Math.min(bill.grandTotal, remainingPayment);
    remainingPayment -= applied;
    const outstanding = bill.grandTotal - applied;

    if (outstanding <= 0) continue;

    const ageDays = differenceInCalendarDays(asOf, parseISO(bill.billDate));
    const bucket = ageBucket(ageDays);

    if (bucket === "0-30") bucket0To30 += outstanding;
    else if (bucket === "31-60") bucket31To60 += outstanding;
    else bucket60Plus += outstanding;

    const dueDate = new Date(parseISO(bill.billDate));
    dueDate.setDate(dueDate.getDate() + paymentCycleDays);

    if (asOf > dueDate) {
      overdueAmount += outstanding;
    }
  }

  const totalOutstanding = bucket0To30 + bucket31To60 + bucket60Plus;

  const paymentStatus: PaymentStatus =
    totalOutstanding <= 0 ? "No Outstanding" : overdueAmount > 0 ? "Overdue" : "Within Cycle";

  return {
    billingPartyId: party.id,
    billingPartyName: party.name,
    paymentCycleDays,
    totalOutstanding,
    bucket0To30,
    bucket31To60,
    bucket60Plus,
    overdueAmount,
    paymentStatus,
  };
}

export async function getOutstandingPaymentReport(
  asOfDate: string,
  filters: OutstandingFilters = {}
): Promise<OutstandingReport> {
  const [billingParties, bills, creditNotes] = await Promise.all([
    getBillingParties(),
    getBills(),
    getCreditNotes(),
  ]);

  const parties = filters.billingPartyId
    ? billingParties.filter((party) => party.id === filters.billingPartyId)
    : billingParties;

  const rows: OutstandingRow[] = parties
    .map((party) => {
      // Bills/payments after the As-Of date must not be included —
      // this report shows the outstanding position as it stood on
      // that date, never a future one.
      const partyBills = bills.filter(
        (bill) => bill.billingPartyId === party.id && bill.billDate <= asOfDate
      );

      const totalPayments = creditNotes
        .filter((note) => note.billingPartyId === party.id && note.noteDate <= asOfDate)
        .reduce((sum, note) => sum + note.amount, 0);

      return buildOutstandingRow(party, partyBills, totalPayments, asOfDate);
    })
    .sort((a, b) => a.billingPartyName.localeCompare(b.billingPartyName));

  return {
    asOfDate,
    rows,
    totalOutstanding: rows.reduce((sum, row) => sum + row.totalOutstanding, 0),
    totalBucket0To30: rows.reduce((sum, row) => sum + row.bucket0To30, 0),
    totalBucket31To60: rows.reduce((sum, row) => sum + row.bucket31To60, 0),
    totalBucket60Plus: rows.reduce((sum, row) => sum + row.bucket60Plus, 0),
    totalOverdue: rows.reduce((sum, row) => sum + row.overdueAmount, 0),
  };
}

/* ==========================================================
   REPORT 3 — BILLING SUMMARY BY BILLING PARTY

   Same approved accounting model as the Outstanding Payment report
   above (Bill = Debit, Credit Note `amount` = Credit in full, Debit
   Notes excluded, deduction informational-only) — but period-scoped by
   Bill Date / Credit Note Date instead of FIFO-aged against a single
   As-Of Date. Total Billing Amount only counts Bills dated within the
   selected range, and Amount Received only counts Credit Notes dated
   within that same range — the two are never mixed across different
   date scopes (e.g. an all-time Bill total against a date-filtered
   payment total), per the approved requirement.
========================================================== */

export interface BillingSummaryRow {
  billingPartyId: number;
  billingPartyName: string;
  billCount: number;
  totalBillingAmount: number;
  amountReceived: number;
  outstandingAmount: number;
}

export interface BillingSummaryReport {
  fromDate: string;
  toDate: string;
  rows: BillingSummaryRow[];
  totalBills: number;
  totalBillingAmount: number;
  totalAmountReceived: number;
  totalOutstanding: number;
}

export interface BillingSummaryFilters {
  billingPartyId?: number;
  fromDate?: string;
  toDate?: string;
}

export async function getBillingSummaryReport(
  filters: BillingSummaryFilters = {}
): Promise<BillingSummaryReport> {
  const [billingParties, bills, creditNotes] = await Promise.all([
    getBillingParties(),
    getBills(),
    getCreditNotes(),
  ]);

  const parties = filters.billingPartyId
    ? billingParties.filter((party) => party.id === filters.billingPartyId)
    : billingParties;

  const rows: BillingSummaryRow[] = parties
    .map((party) => {
      const partyBills = bills.filter((bill) => {
        if (bill.billingPartyId !== party.id) return false;
        if (filters.fromDate && bill.billDate < filters.fromDate) return false;
        if (filters.toDate && bill.billDate > filters.toDate) return false;
        return true;
      });

      // `note.amount` ("Total Amount Received") — never `netAmount` and
      // never `amount - deduction` — is the same Credit value the
      // Ledger uses; deduction stays informational-only here too.
      const partyCreditNotes = creditNotes.filter((note) => {
        if (note.billingPartyId !== party.id) return false;
        if (filters.fromDate && note.noteDate < filters.fromDate) return false;
        if (filters.toDate && note.noteDate > filters.toDate) return false;
        return true;
      });

      const totalBillingAmount = partyBills.reduce((sum, bill) => sum + bill.grandTotal, 0);
      const amountReceived = partyCreditNotes.reduce((sum, note) => sum + note.amount, 0);

      return {
        billingPartyId: party.id,
        billingPartyName: party.name,
        billCount: partyBills.length,
        totalBillingAmount,
        amountReceived,
        outstandingAmount: totalBillingAmount - amountReceived,
      };
    })
    .sort((a, b) => a.billingPartyName.localeCompare(b.billingPartyName));

  return {
    fromDate: filters.fromDate ?? "",
    toDate: filters.toDate ?? "",
    rows,
    totalBills: rows.reduce((sum, row) => sum + row.billCount, 0),
    totalBillingAmount: rows.reduce((sum, row) => sum + row.totalBillingAmount, 0),
    totalAmountReceived: rows.reduce((sum, row) => sum + row.amountReceived, 0),
    totalOutstanding: rows.reduce((sum, row) => sum + row.outstandingAmount, 0),
  };
}

/* ==========================================================
   REPORT 4 — STAFF OPERATIONS ACTIVITY

   Counts LR / POD / Delivery Challan / ASN rows created (and edited)
   by a given app user within a date range. Uses the anon Supabase
   client only — never the service role.
========================================================== */

export type StaffActivityModuleKey = "all" | "lr" | "pod" | "dc" | "asn";

export interface StaffActivityRow {
  module: string;
  moduleKey: Exclude<StaffActivityModuleKey, "all">;
  createdCount: number;
  editedCount: number;
}

export interface StaffActivityReport {
  staffUserId: string;
  fromDate: string;
  toDate: string;
  moduleFilter: StaffActivityModuleKey;
  rows: StaffActivityRow[];
  totalCreated: number;
  totalEdited: number;
}

export interface StaffActivityFilters {
  staffUserId: string;
  fromDate?: string;
  toDate?: string;
  module?: StaffActivityModuleKey;
}

const STAFF_ACTIVITY_MODULES: Array<{
  key: Exclude<StaffActivityModuleKey, "all">;
  label: string;
  table: string;
}> = [
  { key: "lr", label: "LR", table: "lrs" },
  { key: "pod", label: "POD", table: "pods" },
  { key: "dc", label: "Delivery Challan", table: "delivery_challans" },
  { key: "asn", label: "ASN", table: "asn_creations" },
];

async function countStaffOps(
  table: string,
  staffColumn: "created_by" | "updated_by",
  dateColumn: "created_at" | "updated_at",
  staffUserId: string,
  fromDate?: string,
  toDate?: string
): Promise<number> {
  let query = supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(staffColumn, staffUserId);

  if (fromDate) {
    query = query.gte(dateColumn, `${fromDate}T00:00:00`);
  }
  if (toDate) {
    query = query.lte(dateColumn, `${toDate}T23:59:59.999`);
  }

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function getStaffActivityReport(
  filters: StaffActivityFilters
): Promise<StaffActivityReport> {
  const moduleFilter = filters.module ?? "all";
  const modules =
    moduleFilter === "all"
      ? STAFF_ACTIVITY_MODULES
      : STAFF_ACTIVITY_MODULES.filter((module) => module.key === moduleFilter);

  const rows: StaffActivityRow[] = await Promise.all(
    modules.map(async (module) => {
      const [createdCount, editedCount] = await Promise.all([
        countStaffOps(
          module.table,
          "created_by",
          "created_at",
          filters.staffUserId,
          filters.fromDate,
          filters.toDate
        ),
        countStaffOps(
          module.table,
          "updated_by",
          "updated_at",
          filters.staffUserId,
          filters.fromDate,
          filters.toDate
        ),
      ]);

      return {
        module: module.label,
        moduleKey: module.key,
        createdCount,
        editedCount,
      };
    })
  );

  return {
    staffUserId: filters.staffUserId,
    fromDate: filters.fromDate ?? "",
    toDate: filters.toDate ?? "",
    moduleFilter,
    rows,
    totalCreated: rows.reduce((sum, row) => sum + row.createdCount, 0),
    totalEdited: rows.reduce((sum, row) => sum + row.editedCount, 0),
  };
}
