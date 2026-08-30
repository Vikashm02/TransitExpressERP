"use client";

import { ClipboardCheck, Eye, Pencil, Trash2 } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import StatusBadge from "@/components/ui/StatusBadge";
import type { PodRecord } from "@/components/services/pod.service";

/** POD rows joined (client-side, read-only) with their linked LR's
 * Consignee for display — Consignee itself is never stored on `pods`.
 * createdByName is resolved from app_users (never show UUID). */
export type PodListRow = PodRecord & {
  consignee: string;
  createdByName: string;
};

interface PodTableProps {
  pods: PodListRow[];
  loading?: boolean;
  pageSize?: number;
  onView: (pod: PodRecord) => void;
  onEdit: (pod: PodRecord) => void;
  onDelete?: (pod: PodRecord) => void;
  /** Staff / Sub-User Access Control — hides Edit when the caller lacks
   * "pod" edit permission. Defaults to `true` for existing call sites. */
  canEdit?: boolean;
  /** Admin-only delete visibility (AuthProvider isAdmin). */
  canDelete?: boolean;
}

export default function PodTable({
  pods,
  loading,
  pageSize,
  onView,
  onEdit,
  onDelete,
  canEdit = true,
  canDelete = false,
}: PodTableProps) {
  const columns: DataTableColumn<PodListRow>[] = [
    { key: "lrNumber", header: "LR Number", sortable: true, className: "font-medium" },
    { key: "consignee", header: "Consignee", sortable: true },
    { key: "podDate", header: "POD Date", sortable: true },
    { key: "unloadingDate", header: "Unloading Date", sortable: true },
    {
      key: "createdByName",
      header: "Created By",
      render: (row) => row.createdByName,
    },
    {
      key: "podUploaded",
      header: "POD Uploaded",
      sortable: true,
      sortAccessor: (row) => (row.proofUrl ? 1 : 0),
      render: (row) => (
        <StatusBadge
          status={row.proofUrl ? "success" : "inactive"}
          label={row.proofUrl ? "Yes" : "No"}
        />
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={pods}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No PODs found"
      emptyDescription="Add your first proof of delivery to get started."
      emptyIcon={ClipboardCheck}
      sortable
      defaultSort={{ key: "podDate", direction: "desc" }}
      pageSize={pageSize}
      actions={[
        {
          label: "View",
          icon: Eye,
          variant: "outline",
          onClick: onView,
        },
        {
          label: "Edit",
          icon: Pencil,
          variant: "outline",
          onClick: onEdit,
          hidden: () => !canEdit,
        },
        {
          label: "Delete",
          icon: Trash2,
          variant: "outline",
          onClick: (row) => onDelete?.(row),
          hidden: () => !canDelete || !onDelete,
        },
      ]}
    />
  );
}
