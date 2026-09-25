"use client";

import { format, parseISO } from "date-fns";
import type { CompanyRecord } from "@/components/services/company.service";
import type { VehicleDispatchReport } from "@/components/services/vehicleDispatchReport.service";
import styles from "./Report.module.css";

function displayDate(value: string) {
  try { return format(parseISO(value), "dd MMM yyyy"); } catch { return value; }
}

export default function VehicleDispatchPrintView({ report, company, generatedAt }: {
  report: VehicleDispatchReport;
  company: CompanyRecord | null;
  generatedAt: Date;
}) {
  const party = (label: string, value: string) => `${label}: ${value || `All ${label}s`}`;
  return <div className={styles.page}>
    <div className={styles.companyName}>{company?.companyName || "Company Name Not Configured"}</div>
    <div className={styles.reportTitle}>Vehicle Dispatch Report</div>
    <div className={styles.metaRow}>
      <div><span className={styles.label}>Period:</span> {displayDate(report.filters.fromDate)} to {displayDate(report.filters.toDate)}</div>
      <div><span className={styles.label}>{party("Consignor", report.filters.consignor)}</span></div>
      <div><span className={styles.label}>{party("Consignee", report.filters.consignee)}</span></div>
      <div><span className={styles.label}>Generated:</span> {format(generatedAt, "dd MMM yyyy, hh:mm a")}</div>
    </div>
    <div className={styles.metaRow}>
      <div><span className={styles.label}>Total Loads / Trips:</span> {report.summary.totalLoads}</div>
      <div><span className={styles.label}>Unique Vehicles:</span> {report.summary.uniqueVehicles}</div>
      <div><span className={styles.label}>Total Loading Weight:</span> {report.summary.totalLoadingWeight.toLocaleString("en-IN", { maximumFractionDigits: 3 })} MT</div>
    </div>
    <table className={styles.table}>
      <thead><tr><th>LR Date</th><th>LR Number</th><th>Vehicle</th><th>Consignor</th><th>Consignee</th><th>Material</th><th>Loading MT</th><th>From</th><th>To</th></tr></thead>
      <tbody>{report.rows.length ? report.rows.map((row) => <tr key={row.id}><td>{displayDate(row.lrDate)}</td><td>{row.lrNumber}</td><td>{row.vehicleNumber || "—"}</td><td>{row.consignor}</td><td>{row.consignee}</td><td>{row.material}</td><td>{row.loadingWeight.toLocaleString("en-IN", { maximumFractionDigits: 3 })}</td><td>{row.from || "—"}</td><td>{row.to || "—"}</td></tr>) : <tr className={styles.emptyRow}><td colSpan={9}>No qualifying dispatches found.</td></tr>}</tbody>
    </table>
  </div>;
}
