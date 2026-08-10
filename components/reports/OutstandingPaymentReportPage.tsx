"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Download, IndianRupee, Share2 } from "lucide-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import FormField from "@/components/ui/FormField";
import FormDatePicker from "@/components/ui/FormDatePicker";
import StatCard from "@/components/ui/StatCard";
import StatusBadge from "@/components/ui/StatusBadge";
import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import BillingPartyLookup from "@/components/lookup/BillingPartyLookup";
import OutstandingPaymentPrintView from "./OutstandingPaymentPrintView";
import ReportExportDialog from "./ReportExportDialog";

import {
  getOutstandingPaymentReport,
  type OutstandingReport,
  type OutstandingRow,
} from "@/components/services/reports.service";
import { getCompany, type CompanyRecord } from "@/components/services/company.service";
import type { BillingPartyRecord } from "@/components/services/billingParty.service";
import {
  renderElementToPdfFile,
  buildReportExcelFile,
  sanitizeFileNameSegment,
  REPORT_AMOUNT_FORMAT,
} from "@/lib/reportExport";

function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export default function OutstandingPaymentReportPage() {
  const [billingParty, setBillingParty] = useState<BillingPartyRecord | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [asOfDate, setAsOfDate] = useState(todayISO());

  const [company, setCompany] = useState<CompanyRecord | null>(null);
  const [report, setReport] = useState<OutstandingReport | null>(null);
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
    if (!asOfDate) {
      toast.error("Select an As of Date.");
      return;
    }

    // Never runs a future-dated report unless the user explicitly picks
    // one — this only blocks accidentally-empty input, not a
    // deliberately future `asOfDate`.
    try {
      setLoading(true);

      const [reportData, companyData] = await Promise.all([
        getOutstandingPaymentReport(asOfDate, { billingPartyId: billingParty?.id }),
        getCompany(),
      ]);

      setReport(reportData);
      setCompany(companyData);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load the Outstanding Payment report.");
    } finally {
      setLoading(false);
    }
  }

  function handleClearBillingParty() {
    setBillingParty(null);
  }

  const billingPartyLabel = billingParty?.name ?? "All Billing Parties";

  const columns: DataTableColumn<OutstandingRow>[] = [
    { key: "billingPartyName", header: "Billing Party", sortable: true, className: "font-medium" },
    {
      key: "paymentCycleDays",
      header: "Payment Cycle",
      align: "center",
      render: (row) => `${row.paymentCycleDays} Days`,
    },
    {
      key: "totalOutstanding",
      header: "Total Outstanding",
      align: "right",
      sortable: true,
      render: (row) => `₹ ${row.totalOutstanding.toFixed(2)}`,
    },
    {
      key: "bucket0To30",
      header: "0-30 Days",
      align: "right",
      render: (row) => `₹ ${row.bucket0To30.toFixed(2)}`,
    },
    {
      key: "bucket31To60",
      header: "31-60 Days",
      align: "right",
      render: (row) => `₹ ${row.bucket31To60.toFixed(2)}`,
    },
    {
      key: "bucket60Plus",
      header: "60+ Days",
      align: "right",
      render: (row) => `₹ ${row.bucket60Plus.toFixed(2)}`,
    },
    {
      key: "overdueAmount",
      header: "Overdue Amount",
      align: "right",
      sortable: true,
      render: (row) => `₹ ${row.overdueAmount.toFixed(2)}`,
    },
    {
      key: "paymentStatus",
      header: "Payment Status",
      align: "center",
      render: (row) => <StatusBadge status={row.paymentStatus} />,
    },
  ];

  async function buildPdfFile(): Promise<File> {
    if (!captureRef.current || !report) throw new Error("Nothing to export.");

    const fileName = `Outstanding-Payment-${sanitizeFileNameSegment(billingPartyLabel)}-${report.asOfDate}.pdf`;
    return renderElementToPdfFile(captureRef.current, fileName);
  }

  async function buildExcelFile(): Promise<File> {
    if (!report) throw new Error("Nothing to export.");

    const infoRows = [
      { label: "Billing Party", value: billingPartyLabel },
      { label: "As of Date", value: report.asOfDate },
      { label: "Generated", value: format(new Date(), "dd MMM yyyy, hh:mm a") },
    ];

    return buildReportExcelFile<OutstandingRow>({
      title: "Outstanding Payment by Billing Party (Aging)",
      infoRows,
      columns: [
        { header: "Billing Party", width: 28, value: (row) => row.billingPartyName },
        { header: "Payment Cycle (Days)", width: 16, align: "right", value: (row) => row.paymentCycleDays },
        {
          header: "Total Outstanding",
          width: 18,
          align: "right",
          numFmt: REPORT_AMOUNT_FORMAT,
          value: (row) => row.totalOutstanding,
        },
        {
          header: "0-30 Days",
          width: 16,
          align: "right",
          numFmt: REPORT_AMOUNT_FORMAT,
          value: (row) => row.bucket0To30,
        },
        {
          header: "31-60 Days",
          width: 16,
          align: "right",
          numFmt: REPORT_AMOUNT_FORMAT,
          value: (row) => row.bucket31To60,
        },
        {
          header: "60+ Days",
          width: 16,
          align: "right",
          numFmt: REPORT_AMOUNT_FORMAT,
          value: (row) => row.bucket60Plus,
        },
        {
          header: "Overdue Amount",
          width: 18,
          align: "right",
          numFmt: REPORT_AMOUNT_FORMAT,
          value: (row) => row.overdueAmount,
        },
        { header: "Payment Status", width: 16, align: "center", value: (row) => row.paymentStatus },
      ],
      rows: report.rows,
      totalsRow: [
        "Total",
        null,
        report.totalOutstanding,
        report.totalBucket0To30,
        report.totalBucket31To60,
        report.totalBucket60Plus,
        report.totalOverdue,
        null,
      ],
      fileName: `Outstanding-Payment-${sanitizeFileNameSegment(billingPartyLabel)}-${report.asOfDate}.xlsx`,
    });
  }

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Outstanding Payment by Billing Party</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Aging (0-30 / 31-60 / 60+ days) outstanding balance, FIFO-allocated across each party&apos;s Bills.
        </p>
      </div>

      <div className="print:hidden space-y-5 rounded-xl border bg-card p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <FormField
            label="Billing Party"
            htmlFor="outstanding-billing-party"
            hint="Leave blank for All Billing Parties."
          >
            <div className="flex gap-3">
              <Input
                id="outstanding-billing-party"
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

          <FormDatePicker
            label="As of Date"
            id="outstanding-as-of-date"
            required
            value={asOfDate}
            onChange={setAsOfDate}
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={handleRun} disabled={loading}>
            {loading ? "Loading..." : "Run Report"}
          </Button>
        </div>
      </div>

      {report && (
        <>
          <div className="print:hidden grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={IndianRupee} title="Total Outstanding" value={`₹ ${report.totalOutstanding.toFixed(2)}`} />
            <StatCard icon={IndianRupee} title="0-30 Days" value={`₹ ${report.totalBucket0To30.toFixed(2)}`} />
            <StatCard icon={IndianRupee} title="31-60 Days" value={`₹ ${report.totalBucket31To60.toFixed(2)}`} />
            <StatCard icon={IndianRupee} title="60+ Days" value={`₹ ${report.totalBucket60Plus.toFixed(2)}`} />
          </div>

          <div className="print:hidden grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard icon={IndianRupee} title="Overdue Amount" value={`₹ ${report.totalOverdue.toFixed(2)}`} />
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
              emptyIcon={IndianRupee}
              sortable
              defaultSort={{ key: "totalOutstanding", direction: "desc" }}
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
        shareTitle="Outstanding Payment by Billing Party"
        disabled={!report}
        buildPdfFile={buildPdfFile}
        buildExcelFile={buildExcelFile}
      />

      {mounted &&
        report &&
        createPortal(
          <div style={{ position: "fixed", top: 0, left: "-10000px", zIndex: -1 }}>
            <div ref={captureRef}>
              <OutstandingPaymentPrintView
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
