"use client";

import { FileText, Pencil, Printer, Share2, UserCog } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import type { LRRecord } from "@/components/services/lr.service";

interface LRTableProps {
  lrs: LRRecord[];
  loading?: boolean;
  pageSize?: number;
  onEdit: (lr: LRRecord) => void;
  onDelete: (lr: LRRecord) => void;
  onPrint: (lr: LRRecord) => void;
  onShare: (lr: LRRecord) => void;
  /** Admin-only — shows the "Assigned To" column and Reassign action.
   * Staff never see either, matching the read-side RLS restriction
   * (they can only ever see their own LRs anyway). */
  isAdmin?: boolean;
  onReassign?: (lr: LRRecord) => void;
  /** Resolves an `assignedTo` uuid to a display name for the column. */
  resolveAssignedName?: (assignedTo: string | null) => string;
}

export default function LRTable({
  lrs,
  loading,
  pageSize,
  onEdit,
  onDelete,
  onPrint,
  onShare,
  isAdmin = false,
  onReassign,
  resolveAssignedName,
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
  ];

  if (isAdmin) {
    columns.push({
      key: "assignedTo",
      header: "Assigned To",
      render: (row) => resolveAssignedName?.(row.assignedTo) ?? "Unassigned",
    });
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
      actions={[
        {
          label: "Print",
          icon: Printer,
          variant: "outline",
          onClick: onPrint,
        },
        {
          label: "Share",
          icon: Share2,
          variant: "outline",
          onClick: onShare,
        },
        {
          label: "Edit",
          icon: Pencil,
          variant: "outline",
          onClick: onEdit,
        },
        ...(isAdmin && onReassign
          ? [
              {
                label: "Reassign",
                icon: UserCog,
                variant: "outline" as const,
                onClick: onReassign,
              },
            ]
          : []),
      ]}
    />
  );
}
