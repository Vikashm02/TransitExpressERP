"use client";

import { useEffect, useMemo, useState } from "react";

import FormDialog from "@/components/ui/FormDialog";
import FormField from "@/components/ui/FormField";
import FormDatePicker from "@/components/ui/FormDatePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import BillingPartyLookup from "@/components/lookup/BillingPartyLookup";
import type { BillingPartyRecord } from "@/components/services/billingParty.service";
import { getLRs, type LRRecord } from "@/components/services/lr.service";
import { getPods, type PodRecord } from "@/components/services/pod.service";
import { computeBillingLine } from "@/lib/calculations/billingCalculations";
import { amountInWords } from "@/lib/numberToWords";
import { validateBill, type Bill } from "./billing.schema";
import type { BillLineInput } from "@/components/services/billing.service";

interface BillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading?: boolean;
  /** `values.billNumber` is left empty — the caller generates it from
   * Company Master's Invoice numbering settings, exactly like LR Number
   * is generated in LRListPage.tsx, only after this dialog's data is valid. */
  onSubmit: (values: Bill, lines: BillLineInput[]) => void | Promise<void>;
}

interface SelectableRow {
  lr: LRRecord;
  weight: number;
  rate: number;
  freight: number;
  ready: boolean;
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}

/**
 * Create-Bill screen: pick a Billing Party (auto-fills PO Number), a Bill
 * Date, then select from the currently unbilled LRs. Weight/Rate/Freight
 * per LR are computed by `billingCalculations.ts` using ONLY Bill Rate
 * data (+ POD Unloading Weight where applicable) — this dialog never
 * reads or displays any Lorry Hire field.
 */
export default function BillDialog({ open, onOpenChange, loading = false, onSubmit }: BillDialogProps) {
  const [billingParty, setBillingParty] = useState<BillingPartyRecord | null>(null);
  const [poNumber, setPoNumber] = useState("");
  const [billDate, setBillDate] = useState("");
  const [lookupOpen, setLookupOpen] = useState(false);

  const [lrs, setLrs] = useState<LRRecord[]>([]);
  const [pods, setPods] = useState<PodRecord[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  // `lrs.id` is `uuid` live (not `bigint`), so selected LR ids are strings.
  const [selectedLrIds, setSelectedLrIds] = useState<Set<string>>(new Set());

  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setBillingParty(null);
    setPoNumber("");
    setBillDate("");
    setSelectedLrIds(new Set());
    setFormError(null);

    let cancelled = false;
    setDataLoading(true);

    Promise.all([getLRs(), getPods()])
      .then(([lrData, podData]) => {
        if (cancelled) return;
        setLrs(lrData);
        setPods(podData);
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        if (!cancelled) setDataLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  /** Every currently-unbilled LR, with its billable Weight/Rate/Freight
   * (or `ready: false` for a "Per Ton (Unloading)" LR with no POD yet). */
  const selectableRows: SelectableRow[] = useMemo(() => {
    return lrs
      .filter((lr) => lr.status !== "Billed")
      .map((lr) => {
        const pod = pods.find((record) => record.lrNumber === lr.lrNumber);
        const line = computeBillingLine(lr, pod);
        return { lr, ...line };
      });
  }, [lrs, pods]);

  const selectedRows = useMemo(
    () => selectableRows.filter((row) => selectedLrIds.has(String(row.lr.id))),
    [selectableRows, selectedLrIds]
  );

  const totals = useMemo(() => {
    const totalWeight = selectedRows.reduce((sum, row) => sum + row.weight, 0);
    const totalFreight = selectedRows.reduce((sum, row) => sum + row.freight, 0);
    return { totalWeight, totalFreight, grandTotal: totalFreight };
  }, [selectedRows]);

  function handleBillingPartySelect(record: BillingPartyRecord) {
    setBillingParty(record);
    setPoNumber(record.poNumber);
  }

  function toggleRow(row: SelectableRow) {
    if (!row.ready) return;

    // `row.lr.id` is declared `number` in `LRRecord` (a pre-existing,
    // unrelated mismatch in lr.service.ts) but is actually the `uuid`
    // string `lrs.id` at runtime — `String(...)` is a no-op on that real
    // value, just a type-safe way to key this Billing-local `Set<string>`.
    const id = String(row.lr.id);

    setSelectedLrIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleSave() {
    const lrIds = Array.from(selectedLrIds);

    const values: Bill = {
      billNumber: "",
      billDate,
      billingPartyId: billingParty?.id ?? 0,
      poNumber,
      lrIds,
    };

    const fieldErrors = validateBill(values);

    if (Object.keys(fieldErrors).length > 0) {
      setFormError(Object.values(fieldErrors)[0] ?? "Please fix the highlighted fields.");
      return;
    }

    setFormError(null);

    const lines: BillLineInput[] = selectedRows.map((row) => ({
      lrId: String(row.lr.id),
      weight: row.weight,
      rate: row.rate,
      freight: row.freight,
    }));

    onSubmit(values, lines);
  }

  function handleCancel() {
    onOpenChange(false);
  }

  const columns: DataTableColumn<SelectableRow>[] = [
    {
      key: "select",
      header: "",
      width: "36px",
      render: (row) => (
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary disabled:cursor-not-allowed disabled:opacity-40"
          checked={selectedLrIds.has(String(row.lr.id))}
          disabled={!row.ready}
          onChange={() => toggleRow(row)}
        />
      ),
    },
    { key: "lrNumber", header: "LR No.", render: (row) => row.lr.lrNumber },
    { key: "lrDate", header: "LR Date", render: (row) => row.lr.lrDate },
    { key: "consignee", header: "Consignee", render: (row) => row.lr.consignee },
    {
      key: "route",
      header: "Route",
      render: (row) => `${row.lr.from || "—"} → ${row.lr.to || "—"}`,
    },
    { key: "vehicleNumber", header: "Vehicle", render: (row) => row.lr.vehicleNumber },
    { key: "billRateType", header: "Bill Rate Type", render: (row) => row.lr.billRateType },
    {
      key: "weight",
      header: "Weight",
      align: "right",
      render: (row) => (row.ready ? row.weight.toFixed(2) : "—"),
    },
    {
      key: "rate",
      header: "Rate",
      align: "right",
      render: (row) => formatMoney(row.rate),
    },
    {
      key: "freight",
      header: "Freight",
      align: "right",
      render: (row) =>
        row.ready ? (
          formatMoney(row.freight)
        ) : (
          <span className="text-xs font-medium text-warning">Pending POD</span>
        ),
    },
  ];

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Create Bill"
        description="Select a Billing Party, a Bill Date, and the unbilled LRs to include."
        size="fullscreen"
        loading={loading}
        loadingText="Saving Bill..."
        footer={
          <>
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={loading}
            >
              Cancel
            </Button>

            <Button
              onClick={handleSave}
              disabled={loading}
            >
              {loading ? "Saving..." : "Save Bill"}
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-5 rounded-xl border bg-card p-6 shadow-sm md:grid-cols-2 xl:grid-cols-4">
            <FormField
              label="Billing Party"
              htmlFor="bill-billing-party"
              required
            >
              <div className="flex gap-3">
                <Input
                  id="bill-billing-party"
                  readOnly
                  placeholder="Select billing party"
                  value={billingParty?.name ?? ""}
                />

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLookupOpen(true)}
                >
                  Search
                </Button>
              </div>
            </FormField>

            <FormField
              label="PO Number"
              htmlFor="bill-po-number"
              hint="Auto-filled from the Billing Party Master; you can override it for this bill."
            >
              <Input
                id="bill-po-number"
                placeholder="PO Number"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
              />
            </FormField>

            <FormField
              label="Bill Number"
              htmlFor="bill-number"
              hint="Auto-generated from Company Master Document Settings on save."
            >
              <Input
                id="bill-number"
                readOnly
                placeholder="Auto-generated on save"
                value=""
              />
            </FormField>

            <FormDatePicker
              label="Bill Date"
              id="bill-date"
              required
              value={billDate}
              onChange={setBillDate}
            />
          </div>

          <div className="space-y-3">
            <h3 className="text-base font-medium">
              Unbilled LRs
            </h3>

            <DataTable
              columns={columns}
              data={selectableRows}
              rowKey={(row) => row.lr.id}
              loading={dataLoading}
              emptyTitle="No unbilled LRs"
              emptyDescription="Every LR has already been billed."
              maxHeight="360px"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 rounded-xl border bg-card p-6 shadow-sm sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Number of LRs</p>
              <p className="text-lg font-semibold">{selectedRows.length}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Weight</p>
              <p className="text-lg font-semibold">{totals.totalWeight.toFixed(2)} MT</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Freight</p>
              <p className="text-lg font-semibold">₹ {formatMoney(totals.totalFreight)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Grand Total</p>
              <p className="text-lg font-semibold">₹ {formatMoney(totals.grandTotal)}</p>
            </div>
            {selectedRows.length > 0 && (
              <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-4">
                {amountInWords(totals.grandTotal)}
              </p>
            )}
          </div>

          {formError && (
            <p className="text-sm font-medium text-destructive">{formError}</p>
          )}
        </div>
      </FormDialog>

      <BillingPartyLookup
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelect={handleBillingPartySelect}
      />
    </>
  );
}
