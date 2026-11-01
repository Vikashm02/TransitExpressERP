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

/** Display-only Indian grouping (1,23,456.00) — the figures themselves
 * come unchanged from ledger.service.ts. */
function money(value: number): string {
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Modern statement-of-account layout. Rendered on screen, printed via
 * window.print(), and captured by html2canvas for the PDF export
 * (LedgerExportDialog.tsx) — so LedgerStatement.module.css sticks to
 * plain hex colors.
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

  const summary = [
    { label: "Opening Balance", value: statement.openingBalance },
    { label: "Total Debit", value: statement.totalDebit },
    { label: "Total Credit", value: statement.totalCredit },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.accentBar} />

      <header className={styles.header}>
        <div className={styles.brand}>
          {company?.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logoUrl} alt="Company logo" className={styles.logo} crossOrigin="anonymous" />
          )}
          <div>
            <div className={styles.companyName}>{company?.companyName || "Company Name Not Configured"}</div>
            {companyAddressParts.length > 0 && (
              <div className={styles.companyLine}>{companyAddressParts.join(", ")}</div>
            )}
            {companyContactParts.length > 0 && (
              <div className={styles.companyLine}>{companyContactParts.join("  •  ")}</div>
            )}
          </div>
        </div>

        <div className={styles.titleBlock}>
          <div className={styles.eyebrow}>Ledger</div>
          <div className={styles.title}>Statement of Account</div>
          <div className={styles.periodPill}>
            {formatDate(statement.fromDate)} – {formatDate(statement.toDate)}
          </div>
        </div>
      </header>

      <section className={styles.partyRow}>
        <div className={styles.partyCard}>
          <div className={styles.cardLabel}>Account Of</div>
          <div className={styles.partyName}>{statement.billingParty.name}</div>
          <dl className={styles.partyDetails}>
            <dt>Address</dt>
            <dd>{address || "—"}</dd>
            <dt>Email</dt>
            <dd>{email || "—"}</dd>
            <dt>Contact</dt>
            <dd>{contactNumber || "—"}</dd>
          </dl>
        </div>

        <div className={styles.closingCard}>
          <div className={styles.closingLabel}>Closing Balance</div>
          <div className={styles.closingValue}>₹ {money(statement.closingBalance)}</div>
          <div className={styles.closingSub}>as on {formatDate(statement.toDate)}</div>
        </div>
      </section>

      <section className={styles.summaryGrid}>
        {summary.map((item) => (
          <div key={item.label} className={styles.summaryCard}>
            <div className={styles.cardLabel}>{item.label}</div>
            <div className={styles.summaryValue}>₹ {money(item.value)}</div>
          </div>
        ))}
        <div className={styles.summaryCard}>
          <div className={styles.cardLabel}>Transactions</div>
          <div className={styles.summaryValue}>{statement.rows.length}</div>
        </div>
      </section>

      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.colDate}>Date</th>
            <th>Particulars</th>
            <th>Reference</th>
            <th className={styles.right}>Debit (₹)</th>
            <th className={styles.right}>Credit (₹)</th>
            <th className={styles.right}>Balance (₹)</th>
          </tr>
        </thead>
        <tbody>
          <tr className={styles.balanceRow}>
            <td>{formatDate(statement.fromDate)}</td>
            <td colSpan={4}>Opening Balance</td>
            <td className={styles.right}>{money(statement.openingBalance)}</td>
          </tr>

          {statement.rows.length === 0 ? (
            <tr className={styles.emptyRow}>
              <td colSpan={6}>No transactions found for this Billing Party in the selected period.</td>
            </tr>
          ) : (
            statement.rows.map((row, index) => (
              <tr key={index}>
                <td>{formatDate(row.date)}</td>
                <td className={styles.particulars}>{row.particulars}</td>
                <td className={styles.reference}>{row.reference}</td>
                <td className={`${styles.right} ${row.debit > 0 ? styles.debit : styles.muted}`}>
                  {row.debit > 0 ? money(row.debit) : "—"}
                </td>
                <td className={`${styles.right} ${row.credit > 0 ? styles.credit : styles.muted}`}>
                  {row.credit > 0 ? money(row.credit) : "—"}
                </td>
                <td className={`${styles.right} ${styles.balance}`}>{money(row.runningBalance)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Total</td>
            <td className={styles.right}>{money(statement.totalDebit)}</td>
            <td className={styles.right}>{money(statement.totalCredit)}</td>
            <td className={styles.right}>{money(statement.closingBalance)}</td>
          </tr>
        </tfoot>
      </table>

      <footer className={styles.footer}>
        <p>
          This is a system-generated statement reflecting Bills, Credit Notes, and Debit Notes recorded for this
          Billing Party within the selected period.
        </p>
        <p className={styles.generatedOn}>Generated on {format(new Date(), "dd MMM yyyy, hh:mm a")}</p>
      </footer>
    </div>
  );
}
