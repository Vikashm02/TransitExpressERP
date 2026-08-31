"use client";

import { ClipboardCheck, Eye, Pencil, Trash2 } from "lucide-react";
import { format, isValid, parseISO } from "date-fns";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import StatusBadge from "@/components/ui/StatusBadge";
import type { PodRecord } from "@/components/services/pod.service";

/** Same presentation as FormDatePicker (`dd MMM yyyy`). */
const POD_DATE_DISPLAY = "dd MMM yyyy";

function formatPodListDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    const parsed = parseISO(value);
    if (!isValid(parsed)) return value;
    return format(parsed, POD_DATE_DISPLAY);
  } catch {
    return value;
  }
}

/**
 * Sequential sort key for document numbers like LR19372.
 * Uses the trailing digit run so ordering is numeric (19372 > 1939),
 * not lexical, and does not hard-code a prefix.
 */
function lrNumberSortValue(lrNumber: string): number {
  const match = lrNumber.trim().match(/(\d+)\s*$/);
  if (!match) return 0;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : 0;
}

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
    {
      key: "lrNumber",
      header: "LR Number",
      sortable: true,
      className: "font-medium",
      sortAccessor: (row) => lrNumberSortValue(row.lrNumber),
    },
    { key: "consignee", header: "Consignee", sortable: true },
    {
      key: "podDate",
      header: "POD Date",
      sortable: true,
      render: (row) => formatPodListDate(row.podDate),
    },
    {
      key: "unloadingDate",
      header: "Unloading Date",
      sortable: true,
      render: (row) => formatPodListDate(row.unloadingDate),
    },
    {
      key: "unloadingWeight",
      header: "Unloading Weight",
      sortable: true,
    },
    {
      key: "createdAt",
      header: "Created Date",
      sortable: true,
      sortAccessor: (row) => row.created_at ?? "",
      render: (row) => formatPodListDate(row.created_at),
    },
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
      defaultSort={{ key: "lrNumber", direction: "desc" }}
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
