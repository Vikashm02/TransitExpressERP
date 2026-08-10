"use client";

import { format, parseISO } from "date-fns";

import type { OutstandingReport } from "@/components/services/reports.service";
import type { CompanyRecord } from "@/components/services/company.service";
import styles from "./Report.module.css";

interface OutstandingPaymentPrintViewProps {
  report: OutstandingReport;
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

export default function OutstandingPaymentPrintView({
  report,
  company,
  billingPartyLabel,
  generatedAt,
}: OutstandingPaymentPrintViewProps) {
  return (
    <div className={styles.page}>
      <div className={styles.companyName}>{company?.companyName || "Company Name Not Configured"}</div>
      <div className={styles.reportTitle}>Outstanding Payment by Billing Party (Aging)</div>

      <div className={styles.metaRow}>
        <div>
          <span className={styles.label}>Billing Party:</span> {billingPartyLabel}
        </div>
        <div>
          <span className={styles.label}>As of Date:</span> {formatDate(report.asOfDate)}
        </div>
        <div>
          <span className={styles.label}>Generated:</span> {format(generatedAt, "dd MMM yyyy, hh:mm a")}
        </div>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Billing Party</th>
            <th>Payment Cycle</th>
            <th>Total Outstanding</th>
            <th>0-30 Days</th>
            <th>31-60 Days</th>
            <th>60+ Days</th>
            <th>Overdue Amount</th>
            <th>Payment Status</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.length === 0 ? (
            <tr className={styles.emptyRow}>
              <td colSpan={8}>No Billing Parties found.</td>
            </tr>
          ) : (
            report.rows.map((row) => (
              <tr key={row.billingPartyId}>
                <td>{row.billingPartyName}</td>
                <td className={styles.center}>{row.paymentCycleDays} Days</td>
                <td className={styles.right}>{money(row.totalOutstanding)}</td>
                <td className={styles.right}>{money(row.bucket0To30)}</td>
                <td className={styles.right}>{money(row.bucket31To60)}</td>
                <td className={styles.right}>{money(row.bucket60Plus)}</td>
                <td className={styles.right}>{money(row.overdueAmount)}</td>
                <td className={styles.center}>{row.paymentStatus}</td>
              </tr>
            ))
          )}
        </tbody>
        {report.rows.length > 0 && (
          <tfoot>
            <tr className={styles.totalsRow}>
              <td>Total</td>
              <td />
              <td className={styles.right}>{money(report.totalOutstanding)}</td>
              <td className={styles.right}>{money(report.totalBucket0To30)}</td>
              <td className={styles.right}>{money(report.totalBucket31To60)}</td>
              <td className={styles.right}>{money(report.totalBucket60Plus)}</td>
              <td className={styles.right}>{money(report.totalOverdue)}</td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>

      <p className={styles.footerNote}>
        Outstanding is Total Bills minus actual Credit Note payments received, allocated FIFO (oldest Bill first)
        as of the date above. Each Bill&apos;s remaining balance is aged from its own Bill Date and marked overdue
        when the As of Date is past that Bill&apos;s Bill Date + the Billing Party&apos;s Payment Cycle. Debit Notes
        are excluded from this calculation.
      </p>
    </div>
  );
}
