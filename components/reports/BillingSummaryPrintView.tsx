"use client";

import { format, parseISO } from "date-fns";

import type { BillingSummaryReport } from "@/components/services/reports.service";
import type { CompanyRecord } from "@/components/services/company.service";
import styles from "./Report.module.css";

interface BillingSummaryPrintViewProps {
  report: BillingSummaryReport;
  company: CompanyRecord | null;
  billingPartyLabel: string;
  generatedAt: Date;
}

function formatDate(value: string): string {
  try {
    return format(parseISO(value), "dd MMM yyyy");
  } catch {
    return value;
  }
}

function money(value: number): string {
  return `₹ ${value.toFixed(2)}`;
}

export default function BillingSummaryPrintView({
  report,
  company,
  billingPartyLabel,
  generatedAt,
}: BillingSummaryPrintViewProps) {
  return (
    <div className={styles.page}>
      <div className={styles.companyName}>{company?.companyName || "Company Name Not Configured"}</div>
      <div className={styles.reportTitle}>Billing Summary by Billing Party</div>

      <div className={styles.metaRow}>
        <div>
          <span className={styles.label}>Billing Party:</span> {billingPartyLabel}
        </div>

        <div>
          <span className={styles.label}>Period:</span>{" "}
          {report.fromDate ? formatDate(report.fromDate) : "All time"} to{" "}
          {report.toDate ? formatDate(report.toDate) : "Today"}
        </div>

        <div>
          <span className={styles.label}>Generated:</span> {format(generatedAt, "dd MMM yyyy, hh:mm a")}
        </div>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Billing Party</th>
            <th>No. of Bills</th>
            <th>Total Billing Amount</th>
            <th>Amount Received</th>
            <th>Outstanding Amount</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.length === 0 ? (
            <tr className={styles.emptyRow}>
              <td colSpan={5}>No Billing Parties found.</td>
            </tr>
          ) : (
            report.rows.map((row) => (
              <tr key={row.billingPartyId}>
                <td>{row.billingPartyName}</td>
                <td className={styles.center}>{row.billCount}</td>
                <td className={styles.right}>{money(row.totalBillingAmount)}</td>
                <td className={styles.right}>{money(row.amountReceived)}</td>
                <td className={styles.right}>{money(row.outstandingAmount)}</td>
              </tr>
            ))
          )}
        </tbody>
        {report.rows.length > 0 && (
          <tfoot>
            <tr className={styles.totalsRow}>
              <td>Total</td>
              <td className={styles.center}>{report.totalBills}</td>
              <td className={styles.right}>{money(report.totalBillingAmount)}</td>
              <td className={styles.right}>{money(report.totalAmountReceived)}</td>
              <td className={styles.right}>{money(report.totalOutstanding)}</td>
            </tr>
          </tfoot>
        )}
      </table>

      <p className={styles.footerNote}>
        Total Billing Amount includes Bills dated within the selected period; Amount Received includes Credit
        Notes (Total Amount Received) dated within the same period. Discount/Deduction is informational only and
        is never subtracted again. Debit Notes are excluded from this calculation.
      </p>
    </div>
  );
}
