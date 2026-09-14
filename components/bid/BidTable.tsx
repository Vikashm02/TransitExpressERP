"use client";

import { Bell, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import type { BidRecord } from "@/components/services/bid.service";
import { formatReminderTime, type BidReminder } from "@/components/services/bidReminder.service";
import {
  calculateBidProfitability,
  formatINR,
  formatPercent,
} from "@/lib/calculations/bidCalculations";

interface BidTableProps {
  bids: BidRecord[];
  loading?: boolean;
  pageSize?: number;
  onView: (bid: BidRecord) => void;
  onEdit: (bid: BidRecord) => void;
  canEdit?: boolean;
  /** Nearest upcoming Scheduled reminder per bid id (landing-page bell column). */
  reminderInfo?: Map<string, { count: number; nearest: BidReminder }>;
  onReminderClick?: (bid: BidRecord) => void;
}

function profitClass(value: number | null): string {
  if (value === null) return "text-muted-foreground";
  return value < 0 ? "font-semibold text-destructive" : "font-semibold text-foreground";
}

export default function BidTable({ bids, loading = false, pageSize, onView, onEdit, canEdit = false, reminderInfo, onReminderClick }: BidTableProps) {
  const columns: DataTableColumn<BidRecord>[] = [
    {
      key: "bidReference",
      header: "Bid Ref",
      sortable: true,
      className: "font-medium",
      render: (row) => row.bidReference || "—",
    },
    { key: "billingPartyName", header: "Billing Party", sortable: true },
    { key: "status", header: "Status", type: "status", sortable: true },
    {
      key: "route",
      header: "Route",
      render: (row) => `${row.pickupLocation} → ${row.dropoffLocation}`,
      sortAccessor: (row) => `${row.pickupLocation} ${row.dropoffLocation}`,
    },
    { key: "materialName", header: "Material", sortable: true, render: (row) => row.materialName || "—" },
    { key: "vehicleType", header: "Vehicle", sortable: true },
    {
      key: "bidRate",
      header: "Our Rate",
      align: "right",
      render: (row) =>
        row.bidRate > 0 && row.bidRateBasis
          ? `${formatINR(row.bidRate)}${row.bidRateBasis === "Per MT" ? " /MT" : " /Veh"}`
          : "—",
    },
    {
      key: "profitPerMT",
      header: "Profit / MT",
      align: "right",
      render: (row) => {
        const calc = calculateBidProfitability({
          marketVehicleQuote: row.marketVehicleQuote,
          expectedLoadMT: row.expectedLoadMT,
          bidRate: row.bidRate,
          bidRateBasis: row.bidRateBasis,
          totalQuantityMT: row.totalQuantityMT,
        });
        return <span className={profitClass(calc.profitPerMT)}>{formatINR(calc.profitPerMT)}</span>;
      },
    },
    {
      key: "margin",
      header: "Margin %",
      align: "right",
      render: (row) => {
        const calc = calculateBidProfitability({
          marketVehicleQuote: row.marketVehicleQuote,
          expectedLoadMT: row.expectedLoadMT,
          bidRate: row.bidRate,
          bidRateBasis: row.bidRateBasis,
          totalQuantityMT: row.totalQuantityMT,
        });
        return <span className={profitClass(calc.grossProfitPerVehicle)}>{formatPercent(calc.marginPercent)}</span>;
      },
    },
    {
      key: "closesAt",
      header: "Closing",
      render: (row) =>
        row.closesAt ? new Date(row.closesAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—",
      sortAccessor: (row) => row.closesAt ?? "",
    },
    {
      key: "reminder",
      header: "Reminder",
      render: (row) => {
        const info = reminderInfo?.get(row.id);
        const label = !info
          ? "Set Reminder"
          : info.count > 1
            ? `${info.count} reminders`
            : formatReminderTime(info.nearest.remindAt);
        return (
          <Button
            variant="ghost"
            size="sm"
            title={info ? `Next: ${formatReminderTime(info.nearest.remindAt)}` : "Set a reminder"}
            onClick={() => onReminderClick?.(row)}
          >
            <Bell className="mr-1 h-4 w-4" />
            {label}
          </Button>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      align: "center",
      render: (row) => (
        <div className="flex items-center justify-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => onView(row)}>
            View
          </Button>
          {canEdit && (
            <Button variant="ghost" size="icon" title="Edit bid" onClick={() => onEdit(row)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={bids}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No bids found"
      emptyDescription="Create your first transport bid to get started."
      pageSize={pageSize}
    />
  );
}
