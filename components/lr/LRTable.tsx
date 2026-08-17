"use client";

import { FileText, Pencil, Printer, Share2, Trash2, UserCog } from "lucide-react";

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
}

export default function LRTable({
  lrs,
  loading,
  pageSize,
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
}: LRTableProps) {
  const columns: DataTableColumn<LRRecord>[] = [
    { key: "lrNumber", header: "LR No.", sortable: true, className: "font-medium" },
    { key: "lrDate", header: "Date", sortable: true },
    { key: "consignor", header: "Consignor" },
    { key: "consignee", header: "Consignee" },
    { key: "vehicleNumber", header: "Vehicle" },
    {
      key: "route",
      header: "Route",
      sortAccessor: (row) => `${row.from} - ${row.to}`,
      render: (row) => `${row.from || "—"} → ${row.to || "—"}`,
    },
    { key: "freightType", header: "Freight Type" },
    {
      key: "billAmount",
      header: "Bill Amount",
      align: "right",
      sortable: true,
      render: (row) => `₹ ${row.billAmount.toFixed(2)}`,
    },
    { key: "status", header: "Status", type: "status", sortable: true },
    {
      key: "entryStatus",
      header: "Entry",
      sortable: true,
      render: (row) =>
        isDraftEntry(row.entryStatus) ? (
          <StatusBadge
            status={entryStatusBadgeStatus(row.entryStatus)}
            label={entryStatusLabel(row.entryStatus)}
          />
        ) : null,
    },
  ];

  if (isAdmin) {
    columns.push({
      key: "createdBy",
      header: "Created By",
      render: (row) =>
        row.createdBy
          ? resolveAssignedName?.(row.createdBy) ?? "Unknown"
          : "—",
    });
    columns.push({
      key: "assignedTo",
      header: "Assigned To",
      render: (row) => resolveAssignedName?.(row.assignedTo) ?? "Unassigned",
    });
  }

  function handleRowClick(row: LRRecord) {
    if (isDraftEntry(row.entryStatus)) {
      if (canContinueDraft) onContinueDraft(row);
      return;
    }
    if (canEdit) onEdit(row);
  }

  return (
    <DataTable
      columns={columns}
      data={lrs}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No LRs found"
      emptyDescription="Create your first Lorry Receipt to get started."
      emptyIcon={FileText}
      sortable
      defaultSort={{ key: "lrDate", direction: "desc" }}
      pageSize={pageSize}
      getRowClassName={(row) => draftRowClassName(row.entryStatus)}
      onRowClick={handleRowClick}
      actions={[
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
