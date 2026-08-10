"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Download, FileText, Share2 } from "lucide-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import FormField from "@/components/ui/FormField";
import FormDatePicker from "@/components/ui/FormDatePicker";
import StatCard from "@/components/ui/StatCard";
import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import BillingPartyLookup from "@/components/lookup/BillingPartyLookup";
import LRSummaryPrintView from "./LRSummaryPrintView";
import ReportExportDialog from "./ReportExportDialog";

import {
  getLRSummaryByBillingParty,
  type LRSummaryReport,
  type LRSummaryRow,
} from "@/components/services/reports.service";
import { getCompany, type CompanyRecord } from "@/components/services/company.service";
import type { BillingPartyRecord } from "@/components/services/billingParty.service";
import { renderElementToPdfFile, buildReportExcelFile, sanitizeFileNameSegment } from "@/lib/reportExport";

export default function LRSummaryReportPage() {
  const [billingParty, setBillingParty] = useState<BillingPartyRecord | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [company, setCompany] = useState<CompanyRecord | null>(null);
  const [report, setReport] = useState<LRSummaryReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportDialog, setExportDialog] = useState<"download" | "share" | null>(null);
  const [mounted, setMounted] = useState(false);

  const captureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    handleRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRun() {
    try {
      setLoading(true);

      const [reportData, companyData] = await Promise.all([
        getLRSummaryByBillingParty({
          billingPartyId: billingParty?.id,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
        }),
        getCompany(),
      ]);

      setReport(reportData);
      setCompany(companyData);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load the LR Summary report.");
    } finally {
      setLoading(false);
    }
  }

  function handleClearBillingParty() {
    setBillingParty(null);
  }

  const billingPartyLabel = billingParty?.name ?? "All Billing Parties";

  const columns: DataTableColumn<LRSummaryRow>[] = [
    { key: "billingPartyName", header: "Billing Party", sortable: true, className: "font-medium" },
    { key: "totalLRs", header: "Total LRs", align: "right", sortable: true },
    { key: "billedLRs", header: "Billed LRs", align: "right", sortable: true },
    { key: "unbilledLRs", header: "Unbilled LRs", align: "right", sortable: true },
  ];

  async function buildPdfFile(): Promise<File> {
    if (!captureRef.current || !report) throw new Error("Nothing to export.");

    const fileName = `LR-Summary-${sanitizeFileNameSegment(billingPartyLabel)}.pdf`;
    return renderElementToPdfFile(captureRef.current, fileName);
  }

  async function buildExcelFile(): Promise<File> {
    if (!report) throw new Error("Nothing to export.");

    const infoRows = [
      { label: "Billing Party", value: billingPartyLabel },
      ...(report.fromDate || report.toDate
        ? [{ label: "LR Date Period", value: `${report.fromDate || "Start"} to ${report.toDate || "Today"}` }]
        : []),
      { label: "Generated", value: format(new Date(), "dd MMM yyyy, hh:mm a") },
    ];

    return buildReportExcelFile<LRSummaryRow>({
      title: "LR Summary by Billing Party",
      infoRows,
      columns: [
        { header: "Billing Party", width: 30, value: (row) => row.billingPartyName },
        { header: "Total LRs", width: 14, align: "right", value: (row) => row.totalLRs },
        { header: "Billed LRs", width: 14, align: "right", value: (row) => row.billedLRs },
        { header: "Unbilled LRs", width: 16, align: "right", value: (row) => row.unbilledLRs },
      ],
      rows: report.rows,
      totalsRow: ["Total", report.totalLRs, report.totalBilled, report.totalUnbilled],
      fileName: `LR-Summary-${sanitizeFileNameSegment(billingPartyLabel)}.xlsx`,
    });
  }

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">LR Summary by Billing Party</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Total, Billed, and Unbilled LRs for every Billing Party.
        </p>
      </div>

      <div className="print:hidden space-y-5 rounded-xl border bg-card p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <FormField
            label="Billing Party"
            htmlFor="lr-summary-billing-party"
            hint="Leave blank for All Billing Parties."
          >
            <div className="flex gap-3">
              <Input
                id="lr-summary-billing-party"
                readOnly
                placeholder="All Billing Parties"
                value={billingParty?.name ?? ""}
              />

              <Button type="button" variant="outline" onClick={() => setLookupOpen(true)}>
                Search
              </Button>

              {billingParty && (
                <Button type="button" variant="ghost" onClick={handleClearBillingParty}>
                  Clear
                </Button>
              )}
            </div>
          </FormField>

          <FormDatePicker label="From Date (LR Date)" id="lr-summary-from-date" value={fromDate} onChange={setFromDate} />
          <FormDatePicker label="To Date (LR Date)" id="lr-summary-to-date" value={toDate} onChange={setToDate} />
        </div>

        <div className="flex justify-end">
          <Button onClick={handleRun} disabled={loading}>
            {loading ? "Loading..." : "Run Report"}
          </Button>
        </div>
      </div>

      {report && (
        <>
          <div className="print:hidden grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard icon={FileText} title="Total LRs" value={report.totalLRs} />
            <StatCard icon={FileText} title="Billed LRs" value={report.totalBilled} />
            <StatCard icon={FileText} title="Unbilled LRs" value={report.totalUnbilled} />
          </div>

          <div className="print:hidden flex justify-end gap-2">
            <Button variant="outline" onClick={() => setExportDialog("download")}>
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
            <Button variant="outline" onClick={() => setExportDialog("share")}>
              <Share2 className="h-3.5 w-3.5" />
              Share
            </Button>
          </div>

          <div className="print:hidden">
            <DataTable
              columns={columns}
              data={report.rows}
              rowKey={(row) => row.billingPartyId}
              loading={loading}
              emptyTitle="No Billing Parties found"
              emptyIcon={FileText}
              sortable
              defaultSort={{ key: "billingPartyName", direction: "asc" }}
              pageSize={10}
            />
          </div>
        </>
      )}

      <BillingPartyLookup
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelect={(record) => {
          setBillingParty(record);
          setLookupOpen(false);
        }}
      />

      <ReportExportDialog
        open={exportDialog !== null}
        onOpenChange={(next) => setExportDialog(next ? exportDialog : null)}
        variant={exportDialog ?? "download"}
        title={exportDialog === "share" ? "Share Report" : "Download Report"}
        shareTitle="LR Summary by Billing Party"
        disabled={!report}
        buildPdfFile={buildPdfFile}
        buildExcelFile={buildExcelFile}
      />

      {mounted &&
        report &&
        createPortal(
          <div style={{ position: "fixed", top: 0, left: "-10000px", zIndex: -1 }}>
            <div ref={captureRef}>
              <LRSummaryPrintView
                report={report}
                company={company}
                billingPartyLabel={billingPartyLabel}
                generatedAt={new Date()}
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
