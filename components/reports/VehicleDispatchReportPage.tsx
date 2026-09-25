"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { Download, Share2, Truck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import FormDatePicker from "@/components/ui/FormDatePicker";
import FormField from "@/components/ui/FormField";
import StatCard from "@/components/ui/StatCard";
import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import MasterAutocomplete, { type MasterAutocompleteOption } from "@/components/lookup/MasterAutocomplete";
import ReportExportDialog from "./ReportExportDialog";
import VehicleDispatchPrintView from "./VehicleDispatchPrintView";
import { getCompany, type CompanyRecord } from "@/components/services/company.service";
import { buildReportExcelFile, renderElementToPdfFile, sanitizeFileNameSegment } from "@/lib/reportExport";
import { getAllVehicleDispatchRows, getVehicleDispatchFilterOptions, getVehicleDispatchReport, type VehicleDispatchFilterOptions, type VehicleDispatchReport, type VehicleDispatchRow } from "@/components/services/vehicleDispatchReport.service";

const PAGE_SIZE = 50;

function todayIso() { return format(new Date(), "yyyy-MM-dd"); }
function weight(value: number) { return `${value.toLocaleString("en-IN", { maximumFractionDigits: 3 })} MT`; }
function optionList(items: string[]): MasterAutocompleteOption[] { return items.map((label) => ({ id: label, label })); }

export default function VehicleDispatchReportPage() {
  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(todayIso());
  const [consignor, setConsignor] = useState("");
  const [consignee, setConsignee] = useState("");
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<VehicleDispatchReport | null>(null);
  const [partyOptions, setPartyOptions] = useState<VehicleDispatchFilterOptions>({ consignors: [], consignees: [] });
  const [company, setCompany] = useState<CompanyRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [preparingExport, setPreparingExport] = useState(false);
  const [exportReport, setExportReport] = useState<VehicleDispatchReport | null>(null);
  const [exportDialog, setExportDialog] = useState<"download" | "share" | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const latestRequestRef = useRef(0);
  const latestFilterOptionsRequestRef = useRef(0);

  const consignorOptions = useMemo(() => optionList(partyOptions.consignors), [partyOptions]);
  const consigneeOptions = useMemo(() => optionList(partyOptions.consignees), [partyOptions]);

  useEffect(() => { void run(1); /* initial valid today range */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const requestId = ++latestFilterOptionsRequestRef.current;

    void (async () => {
      // Defer state work so the effect only begins the external request.
      await Promise.resolve();
      if (requestId !== latestFilterOptionsRequestRef.current) return;

      if (!fromDate || !toDate || fromDate > toDate) {
        setPartyOptions({ consignors: [], consignees: [] });
        return;
      }

      const dateRange = { fromDate, toDate };
      setPartyOptions({ consignors: [], consignees: [] });

      try {
        const nextOptions = await getVehicleDispatchFilterOptions(dateRange);
        if (requestId === latestFilterOptionsRequestRef.current) {
          setPartyOptions(nextOptions);
        }
      } catch (error) {
        if (requestId === latestFilterOptionsRequestRef.current) {
          console.error(error);
        }
      }
    })();
  }, [fromDate, toDate]);

  async function run(nextPage = page) {
    if (!fromDate || !toDate) { toast.error("Select both From Date and To Date."); return; }
    if (fromDate > toDate) { toast.error("From Date cannot be after To Date."); return; }

    const requestId = ++latestRequestRef.current;
    const requestFilters = {
      fromDate,
      toDate,
      consignor,
      consignee,
      page: nextPage,
      pageSize: PAGE_SIZE,
    };

    try {
      setLoading(true);
      const [next, nextCompany] = await Promise.all([
        getVehicleDispatchReport(requestFilters),
        getCompany(),
      ]);
      if (requestId !== latestRequestRef.current) return;
      setReport(next); setCompany(nextCompany); setPage(nextPage);
    } catch (error) {
      if (requestId !== latestRequestRef.current) return;
      console.error(error); toast.error("Unable to load the Vehicle Dispatch Report.");
    } finally {
      if (requestId === latestRequestRef.current) setLoading(false);
    }
  }

  async function prepareExport(kind: "download" | "share") {
    if (!fromDate || !toDate || fromDate > toDate) { toast.error("Select a valid date range first."); return; }
    try {
      setPreparingExport(true);
      const all = await getAllVehicleDispatchRows({ fromDate, toDate, consignor, consignee });
      setExportReport(all); setExportDialog(kind);
    } catch (error) { console.error(error); toast.error("Unable to prepare the complete report export."); }
    finally { setPreparingExport(false); }
  }

  const columns: DataTableColumn<VehicleDispatchRow>[] = [
    { key: "lrDate", header: "LR Date", sortable: true },
    { key: "lrNumber", header: "LR Number", sortable: true, className: "font-medium" },
    { key: "vehicleNumber", header: "Vehicle Number", sortable: true, emptyDisplay: "none" },
    { key: "consignor", header: "Consignor", sortable: true },
    { key: "consignee", header: "Consignee", sortable: true },
    { key: "material", header: "Material", sortable: true },
    { key: "loadingWeight", header: "Loading Weight (MT)", align: "right", sortable: true, render: (row) => weight(row.loadingWeight) },
    { key: "from", header: "From", sortable: true, emptyDisplay: "none" },
    { key: "to", header: "To", sortable: true, emptyDisplay: "none" },
  ];

  async function buildPdfFile() {
    if (!captureRef.current || !exportReport) throw new Error("Complete report export is not ready.");
    return renderElementToPdfFile(captureRef.current, `Vehicle-Dispatch-${fromDate}-to-${toDate}.pdf`);
  }
  async function buildExcelFile() {
    if (!exportReport) throw new Error("Complete report export is not ready.");
    return buildReportExcelFile<VehicleDispatchRow>({
      title: "Vehicle Dispatch Report",
      infoRows: [
        { label: "Period", value: `${fromDate} to ${toDate}` },
        { label: "Consignor", value: consignor || "All Consignors" },
        { label: "Consignee", value: consignee || "All Consignees" },
        { label: "Total Loads / Trips", value: String(exportReport.summary.totalLoads) },
        { label: "Unique Vehicles", value: String(exportReport.summary.uniqueVehicles) },
        { label: "Total Loading Weight", value: weight(exportReport.summary.totalLoadingWeight) },
      ],
      columns: [
        { header: "LR Date", width: 14, value: (row) => row.lrDate }, { header: "LR Number", width: 16, value: (row) => row.lrNumber },
        { header: "Vehicle Number", width: 18, value: (row) => row.vehicleNumber }, { header: "Consignor", width: 28, value: (row) => row.consignor },
        { header: "Consignee", width: 28, value: (row) => row.consignee }, { header: "Material", width: 22, value: (row) => row.material },
        { header: "Loading Weight (MT)", width: 20, align: "right", value: (row) => row.loadingWeight }, { header: "From", width: 18, value: (row) => row.from }, { header: "To", width: 18, value: (row) => row.to },
      ], rows: exportReport.rows,
      totalsRow: ["Total", exportReport.summary.totalLoads, null, null, null, null, exportReport.summary.totalLoadingWeight, null, null],
      fileName: `Vehicle-Dispatch-${sanitizeFileNameSegment(`${fromDate}-to-${toDate}`)}.xlsx`,
    });
  }

  return <div className="space-y-6">
    <div className="print:hidden"><h1 className="text-2xl font-semibold tracking-tight text-foreground">Vehicle Dispatch Report</h1><p className="mt-1 text-sm text-muted-foreground">Vehicle loads/trips, unique vehicles, and loading weight by Consignor, Consignee, and LR date.</p></div>
    <div className="print:hidden space-y-5 rounded-xl border bg-card p-6 shadow-sm"><div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
      <FormDatePicker label="From Date" id="vehicle-dispatch-from" required value={fromDate} onChange={setFromDate} />
      <FormDatePicker label="To Date" id="vehicle-dispatch-to" required value={toDate} onChange={setToDate} />
      <FormField label="Consignor" htmlFor="vehicle-dispatch-consignor" hint="Leave blank for All Consignors."><MasterAutocomplete id="vehicle-dispatch-consignor" value={consignor} options={consignorOptions} onSelect={(option) => setConsignor(option.label)} onClear={() => setConsignor("")} placeholder="All Consignors" emptyMessage="No consignor in this period." /></FormField>
      <FormField label="Consignee" htmlFor="vehicle-dispatch-consignee" hint="Leave blank for All Consignees."><MasterAutocomplete id="vehicle-dispatch-consignee" value={consignee} options={consigneeOptions} onSelect={(option) => setConsignee(option.label)} onClear={() => setConsignee("")} placeholder="All Consignees" emptyMessage="No consignee in this period." /></FormField>
    </div><div className="flex justify-end"><Button onClick={() => void run(1)} disabled={loading}>{loading ? "Loading..." : "Run Report"}</Button></div></div>
    {report ? <><div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><StatCard icon={Truck} title="Total Loads / Trips" value={report.summary.totalLoads} /><StatCard icon={Truck} title="Unique Vehicles" value={report.summary.uniqueVehicles} /><StatCard icon={Truck} title="Total Loading Weight" value={weight(report.summary.totalLoadingWeight)} /></div>
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={preparingExport} onClick={() => void prepareExport("download")}><Download className="h-3.5 w-3.5" />{preparingExport ? "Preparing..." : "Download"}</Button><Button variant="outline" disabled={preparingExport} onClick={() => void prepareExport("share")}><Share2 className="h-3.5 w-3.5" />Share</Button></div>
      <DataTable columns={columns} data={report.rows} rowKey={(row) => row.id} loading={loading} emptyTitle="No qualifying dispatches found" emptyIcon={Truck} sortable defaultSort={{ key: "lrDate", direction: "desc" }} pageSize={PAGE_SIZE} page={page} onPageChange={(next) => void run(next)} totalItems={report.pagination.totalCount} />
    </> : null}
    <ReportExportDialog open={exportDialog !== null} onOpenChange={(next) => setExportDialog(next ? exportDialog : null)} variant={exportDialog ?? "download"} title={exportDialog === "share" ? "Share Report" : "Download Report"} shareTitle="Vehicle Dispatch Report" disabled={!exportReport} buildPdfFile={buildPdfFile} buildExcelFile={buildExcelFile} />
    {exportReport ? createPortal(<div style={{ position: "fixed", top: 0, left: "-10000px", zIndex: -1 }}><div ref={captureRef}><VehicleDispatchPrintView report={exportReport} company={company} generatedAt={new Date()} /></div></div>, document.body) : null}
  </div>;
}
