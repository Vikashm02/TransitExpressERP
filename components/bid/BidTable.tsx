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
      render: (row) => row.bidReference || "No Reference",
    },
    {
      key: "billingPartyName",
      header: "Billing Party",
      sortable: true,
      // Mobile: full-width row so long party names wrap naturally.
      mobile: "full",
    },
    { key: "status", header: "Status", type: "status", sortable: true },
    {
      key: "route",
      header: "Route",
      // Mobile: full-width row so long lanes wrap naturally.
      mobile: "full",
      render: (row) => `${row.pickupLocation} → ${row.dropoffLocation}`,
      sortAccessor: (row) => `${row.pickupLocation} ${row.dropoffLocation}`,
    },
    {
      key: "materialName",
      header: "Material",
      sortable: true,
      // Null keeps desktop "—" (shared fallback) while mobile omits the row.
      render: (row) => row.materialName || null,
    },
    {
      key: "vehicleType",
      header: "Vehicle",
      sortable: true,
      // Null keeps desktop "—" (shared fallback) while mobile omits the row.
      render: (row) => row.vehicleType || null,
    },
    {
      key: "bidRate",
      // Mobile commercial-summary row (label left, value right).
      header: "Our Rate",
      mobile: "summary",
      align: "right",
      render: (row) =>
        row.bidRate > 0 && row.bidRateBasis
          ? `${formatINR(row.bidRate)}${row.bidRateBasis === "Per MT" ? " /MT" : " /Veh"}`
          : null,
    },
    {
      key: "profitPerMT",
      // Mobile commercial-summary row (label left, value right).
      header: "Profit / MT",
      mobile: "summary",
      align: "right",
      render: (row) => {
        const calc = calculateBidProfitability({
          marketVehicleQuote: row.marketVehicleQuote,
          expectedLoadMT: row.expectedLoadMT,
          bidRate: row.bidRate,
          bidRateBasis: row.bidRateBasis,
          totalQuantityMT: row.totalQuantityMT,
        });
        if (calc.profitPerMT == null) return null;
        return <span className={profitClass(calc.profitPerMT)}>{formatINR(calc.profitPerMT)}</span>;
      },
    },
    {
      key: "margin",
      // Mobile commercial-summary row (label left, value right).
      header: "Margin %",
      mobile: "summary",
      align: "right",
      render: (row) => {
        const calc = calculateBidProfitability({
          marketVehicleQuote: row.marketVehicleQuote,
          expectedLoadMT: row.expectedLoadMT,
          bidRate: row.bidRate,
          bidRateBasis: row.bidRateBasis,
          totalQuantityMT: row.totalQuantityMT,
        });
        if (calc.marginPercent == null) return null;
        return <span className={profitClass(calc.grossProfitPerVehicle)}>{formatPercent(calc.marginPercent)}</span>;
      },
    },
    {
      key: "closesAt",
      // Mobile commercial-summary row (label left, value right).
      header: "Closing",
      mobile: "summary",
      render: (row) =>
        row.closesAt ? new Date(row.closesAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : null,
      sortAccessor: (row) => row.closesAt ?? "",
    },
    {
      key: "reminder",
      header: "Reminder",
      // Mobile top row: compact tappable bell next to the status badge.
      mobile: "top",
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
            className="min-h-[40px]"
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
      // Mobile bottom strip: comfortable touch targets, shown once.
      mobile: "actions",
      // Desktop keeps the existing compact ghost buttons; the max-md:
      // classes below only stretch them into comfortable separated
      // touch targets inside the mobile action strip.
      render: (row) => (
        <div className="flex items-center justify-center gap-2 max-md:items-stretch">
          <Button
            variant="ghost"
            size="sm"
            className="min-h-[40px] max-md:min-h-[44px] max-md:flex-1"
            onClick={() => onView(row)}
          >
            View
          </Button>
          {canEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="min-h-[40px] min-w-[40px] max-md:min-h-[44px] max-md:min-w-[44px]"
              title="Edit bid"
              onClick={() => onEdit(row)}
            >
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
