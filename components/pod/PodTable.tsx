"use client";

import { ClipboardCheck, Eye, Pencil } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import StatusBadge from "@/components/ui/StatusBadge";
import type { PodRecord } from "@/components/services/pod.service";

/** POD rows joined (client-side, read-only) with their linked LR's
 * Consignee for display — Consignee itself is never stored on `pods`. */
export type PodListRow = PodRecord & { consignee: string };

interface PodTableProps {
  pods: PodListRow[];
  loading?: boolean;
  pageSize?: number;
  onView: (pod: PodRecord) => void;
  onEdit: (pod: PodRecord) => void;
}

export default function PodTable({
  pods,
  loading,
  pageSize,
  onView,
  onEdit,
}: PodTableProps) {
  const columns: DataTableColumn<PodListRow>[] = [
    { key: "lrNumber", header: "LR Number", sortable: true, className: "font-medium" },
    { key: "consignee", header: "Consignee", sortable: true },
    { key: "podDate", header: "POD Date", sortable: true },
    { key: "unloadingDate", header: "Unloading Date", sortable: true },
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
        },
      ]}
    />
  );
}
