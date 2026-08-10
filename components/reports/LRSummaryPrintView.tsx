"use client";

import { format, parseISO } from "date-fns";

import type { LRSummaryReport } from "@/components/services/reports.service";
import type { CompanyRecord } from "@/components/services/company.service";
import styles from "./Report.module.css";

interface LRSummaryPrintViewProps {
  report: LRSummaryReport;
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

export default function LRSummaryPrintView({
  report,
  company,
  billingPartyLabel,
  generatedAt,
}: LRSummaryPrintViewProps) {
  return (
    <div className={styles.page}>
      <div className={styles.companyName}>{company?.companyName || "Company Name Not Configured"}</div>
      <div className={styles.reportTitle}>LR Summary by Billing Party</div>

      <div className={styles.metaRow}>
        <div>
          <span className={styles.label}>Billing Party:</span> {billingPartyLabel}
        </div>

        {(report.fromDate || report.toDate) && (
          <div>
            <span className={styles.label}>LR Date Period:</span>{" "}
            {report.fromDate ? formatDate(report.fromDate) : "Start"} to{" "}
            {report.toDate ? formatDate(report.toDate) : "Today"}
          </div>
        )}

        <div>
          <span className={styles.label}>Generated:</span> {format(generatedAt, "dd MMM yyyy, hh:mm a")}
        </div>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Billing Party</th>
            <th>Total LRs</th>
            <th>Billed LRs</th>
            <th>Unbilled LRs</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.length === 0 ? (
            <tr className={styles.emptyRow}>
              <td colSpan={4}>No Billing Parties found.</td>
            </tr>
          ) : (
            report.rows.map((row) => (
              <tr key={row.billingPartyId}>
                <td>{row.billingPartyName}</td>
                <td className={styles.center}>{row.totalLRs}</td>
                <td className={styles.center}>{row.billedLRs}</td>
                <td className={styles.center}>{row.unbilledLRs}</td>
              </tr>
            ))
          )}
        </tbody>
        {report.rows.length > 0 && (
          <tfoot>
            <tr className={styles.totalsRow}>
              <td>Total</td>
              <td className={styles.center}>{report.totalLRs}</td>
              <td className={styles.center}>{report.totalBilled}</td>
              <td className={styles.center}>{report.totalUnbilled}</td>
            </tr>
          </tfoot>
        )}
      </table>

      <p className={styles.footerNote}>
        &quot;Billed&quot; reflects the LR module&apos;s own status field; every other LR status is counted as
        Unbilled.
      </p>
    </div>
  );
}
