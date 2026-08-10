"use client";

import { format, parseISO } from "date-fns";

import type { LedgerStatement } from "@/components/services/ledger.service";
import type { CompanyRecord } from "@/components/services/company.service";
import styles from "./LedgerStatement.module.css";

interface LedgerStatementViewProps {
  statement: LedgerStatement;
  company: CompanyRecord | null;
  /** Editable-for-this-statement-only party details — never written back
   * to Billing Party Master (see LedgerPage.tsx). */
  address: string;
  email: string;
  contactNumber: string;
}

function formatDate(value: string): string {
  try {
    return format(parseISO(value), "dd MMM yyyy");
  } catch {
    return value;
  }
}

function money(value: number): string {
  return value.toFixed(2);
}

/**
 * A plain, professional statement layout — intentionally NOT a copy of
 * the Billing Tax Invoice design (components/billing/BillPrint.tsx).
 */
export default function LedgerStatementView({
  statement,
  company,
  address,
  email,
  contactNumber,
}: LedgerStatementViewProps) {
  const companyAddressParts = [company?.address, company?.city, company?.state, company?.pincode].filter(
    Boolean
  );
  const companyContactParts = [
    company?.gstin ? `GSTIN: ${company.gstin}` : null,
    company?.mobile,
    company?.email,
  ].filter(Boolean);

  return (
    <div className={styles.page}>
      <div className={styles.companyName}>{company?.companyName || "Company Name Not Configured"}</div>

      {companyAddressParts.length > 0 && (
        <div className={styles.companyLine}>{companyAddressParts.join(", ")}</div>
      )}

      {companyContactParts.length > 0 && (
        <div className={styles.companyLine}>{companyContactParts.join(" | ")}</div>
      )}

      <div className={styles.statementHeading}>Statement of Account</div>

      <div className={styles.metaGrid}>
        <div>
          <div className={styles.accountOf}>ACCOUNT OF: {statement.billingParty.name}</div>
          <div>
            <span className={styles.label}>Address:</span> {address || "—"}
          </div>
          <div>
            <span className={styles.label}>Email:</span> {email || "—"}
          </div>
          <div>
            <span className={styles.label}>Contact Number:</span> {contactNumber || "—"}
          </div>
        </div>

        <div className={styles.periodBlock}>
          <div className={styles.label}>Statement Period</div>
          <div>
            {formatDate(statement.fromDate)} to {formatDate(statement.toDate)}
          </div>
        </div>
      </div>

      <div className={styles.openingBalanceRow}>
        <span>Opening Balance</span>
        <span>₹ {money(statement.openingBalance)}</span>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Particulars</th>
            <th>Reference</th>
            <th>Debit</th>
            <th>Credit</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody>
          {statement.rows.length === 0 ? (
            <tr className={styles.emptyRow}>
              <td colSpan={6}>No transactions found for this Billing Party in the selected period.</td>
            </tr>
          ) : (
            statement.rows.map((row, index) => (
              <tr key={index}>
                <td className={styles.center}>{formatDate(row.date)}</td>
                <td>{row.particulars}</td>
                <td>{row.reference}</td>
                <td className={styles.right}>{row.debit > 0 ? money(row.debit) : "—"}</td>
                <td className={styles.right}>{row.credit > 0 ? money(row.credit) : "—"}</td>
                <td className={styles.right}>{money(row.runningBalance)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className={styles.totalsBlock}>
        <table className={styles.totalsTable}>
          <tbody>
            <tr>
              <td className={styles.totalsLabel}>Total Debit</td>
              <td className={styles.right}>₹ {money(statement.totalDebit)}</td>
            </tr>
            <tr>
              <td className={styles.totalsLabel}>Total Credit</td>
              <td className={styles.right}>₹ {money(statement.totalCredit)}</td>
            </tr>
            <tr className={styles.closingRow}>
              <td className={styles.totalsLabel}>Closing Balance</td>
              <td className={styles.right}>₹ {money(statement.closingBalance)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className={styles.footerNote}>
        This is a system-generated statement reflecting Bills, Credit Notes, and Debit Notes recorded for this
        Billing Party within the selected period.
      </p>
    </div>
  );
}
