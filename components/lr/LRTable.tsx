"use client";

import { Eye, FileText, Pencil, Printer, Share2, Trash2, UserCog } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import StatusBadge from "@/components/ui/StatusBadge";
import type { LRRecord } from "@/components/services/lr.service";
import {
  draftRowClassName,
  entryStatusBadgeStatus,
  entryStatusLabel,
  isDraftEntry,
} from "@/lib/entryStatus";

interface LRTableProps {
  lrs: LRRecord[];
  loading?: boolean;
  pageSize?: number;
  /** Open any visible LR in view mode. */
  onView: (lr: LRRecord) => void;
  onEdit: (lr: LRRecord) => void;
  /** Resume incomplete draft — must NOT require Edit permission. */
  onContinueDraft: (lr: LRRecord) => void;
  onDelete: (lr: LRRecord) => void;
  onPrint: (lr: LRRecord) => void;
  onShare: (lr: LRRecord) => void;
  isAdmin?: boolean;
  onReassign?: (lr: LRRecord) => void;
  resolveAssignedName?: (assignedTo: string | null) => string;
  canEdit?: boolean;
  /** Create or Edit — required to open/continue a draft row. */
  canContinueDraft?: boolean;
  canDelete?: boolean;
  canPrint?: boolean;
  canShare?: boolean;
  /** Open Consignee Intelligence for the exact consignee name on this row. */
  onConsigneeClick?: (lr: LRRecord) => void;
}

export default function LRTable({
  lrs,
  loading,
  pageSize,
  onView,
  onEdit,
  onContinueDraft,
  onDelete,
  onPrint,
  onShare,
  isAdmin = false,
  onReassign,
  resolveAssignedName,
  canEdit = true,
  canContinueDraft = true,
  canDelete = true,
  canPrint = true,
  canShare = true,
  onConsigneeClick,
}: LRTableProps) {
  const columns: DataTableColumn<LRRecord>[] = [
    { key: "lrNumber", header: "LR No.", className: "font-medium" },
    { key: "lrDate", header: "Date" },
    { key: "consignor", header: "Consignor" },
    {
      key: "consignee",
      header: "Consignee",
      render: (row) => {
        const name = (row.consignee || "").trim();
        if (!name) return "—";
        if (!onConsigneeClick) return name;
        return (
          <button
            type="button"
            className="text-left font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => {
              event.stopPropagation();
              onConsigneeClick(row);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.stopPropagation();
              }
            }}
          >
            {name}
          </button>
        );
      },
    },
    { key: "vehicleNumber", header: "Vehicle" },
    {
      key: "route",
      header: "Route",
      render: (row) => `${row.from || "—"} → ${row.to || "—"}`,
    },
    { key: "freightType", header: "Freight Type" },
    { key: "status", header: "Status", type: "status" },
    {
      key: "entryStatus",
      header: "Entry",
      render: (row) =>
        isDraftEntry(row.entryStatus) ? (
          <StatusBadge
            status={entryStatusBadgeStatus(row.entryStatus)}
            label={entryStatusLabel(row.entryStatus)}
          />
        ) : null,
    },
    {
      key: "createdBy",
      header: "Created By",
      render: (row) =>
        row.createdBy
          ? resolveAssignedName?.(row.createdBy) ?? "Unknown"
          : "—",
    },
  ];

  if (isAdmin) {
    columns.push({
      key: "assignedTo",
      header: "Assigned To",
      render: (row) => resolveAssignedName?.(row.assignedTo) ?? "Unassigned",
    });
  }

  // Fixed dashboard order: numeric LR number descending (never lexicographic).
  // e.g. LR19311 > LR19310 > … > LR1932 > LR1931. No alternate column sorts.
  const orderedLrs = [...lrs].sort((a, b) => {
    const numA = Number(String(a.lrNumber || "").replace(/\D/g, "")) || 0;
    const numB = Number(String(b.lrNumber || "").replace(/\D/g, "")) || 0;
    return numB - numA;
  });

  return (
    <DataTable
      columns={columns}
      data={orderedLrs}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No LRs found"
      emptyDescription="Create your first Lorry Receipt to get started."
      emptyIcon={FileText}
      pageSize={pageSize}
      getRowClassName={(row) => draftRowClassName(row.entryStatus)}
      onRowClick={onView}
      actions={[
        {
          label: "View",
          icon: Eye,
          variant: "outline",
          onClick: onView,
        },
        {
          label: "Print",
          icon: Printer,
          variant: "outline",
          onClick: onPrint,
          hidden: (row) => !canPrint || isDraftEntry(row.entryStatus),
        },
        {
          label: "Share",
          icon: Share2,
          variant: "outline",
          onClick: onShare,
          hidden: (row) => !canShare || isDraftEntry(row.entryStatus),
        },
        {
          label: "Continue",
          icon: Pencil,
          variant: "outline",
          onClick: onContinueDraft,
          hidden: (row) => !isDraftEntry(row.entryStatus) || !canContinueDraft,
        },
        {
          label: "Edit",
          icon: Pencil,
          variant: "outline",
          onClick: onEdit,
          hidden: (row) => isDraftEntry(row.entryStatus) || !canEdit,
        },
        {
          label: "Delete",
          icon: Trash2,
          variant: "destructive",
          onClick: onDelete,
          hidden: () => !canDelete,
        },
        ...(isAdmin && onReassign
          ? [
              {
                label: "Reassign",
                icon: UserCog,
                variant: "outline" as const,
                onClick: onReassign,
                hidden: (row: LRRecord) => isDraftEntry(row.entryStatus) || !canEdit,
              },
            ]
          : []),
      ]}
    />
  );
}
