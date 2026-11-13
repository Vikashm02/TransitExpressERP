"use client";

import { Package, Pencil, Trash2 } from "lucide-react";

import LrCountBadges from "@/components/common/LrCountBadges";
import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import RelativeCreatedTime from "@/components/common/RelativeCreatedTime";
import type { MaterialRecord } from "@/components/services/material.service";

interface MaterialTableProps {
  materials: MaterialRecord[];
  loading?: boolean;
  pageSize?: number;
  onEdit: (material: MaterialRecord) => void;
  onDelete: (material: MaterialRecord) => void;
  /** Delete is Creator-only (migrations 047/048). */
  canDelete?: boolean;
  /** Saved LRs per record, shown as a badge in the action strip; hidden when undefined (see useLrUsageRows). */
  lrCounts?: Map<number, number>;
  /** Rows arrive already sorted by LR count (most first); skip the default sort. */
  sortByLrs?: boolean;
}

export default function MaterialTable({
  materials,
  loading,
  pageSize,
  onEdit,
  onDelete,
  canDelete = false,
  lrCounts,
  sortByLrs = false,
}: MaterialTableProps) {
  const columns: DataTableColumn<MaterialRecord>[] = [
    { key: "code", header: "Material Code", sortable: true, width: "12%" },
    { key: "materialName", header: "Material Name", sortable: true, className: "font-medium" },
    { key: "category", header: "Category", sortable: true },
    { key: "hsnCode", header: "HSN Code" },
    { key: "status", header: "Status", type: "status", sortable: true },
    {
      key: "created_at",
      header: "Created",
      sortable: true,
      sortAccessor: (row) => row.created_at ?? "",
      render: (row) => <RelativeCreatedTime value={row.created_at} />,
    },
  ];

  return (
    <DataTable
      key={sortByLrs ? "lr-sort" : "default-sort"}
      columns={columns}
      data={materials}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No materials found"
      emptyDescription="Add your first material to get started."
      emptyIcon={Package}
      sortable
      defaultSort={sortByLrs ? undefined : { key: "materialName", direction: "asc" }}
      pageSize={pageSize}
      actionsAside={
        lrCounts
          ? (row) => <LrCountBadges items={[{ label: "LRs", count: lrCounts.get(row.id) ?? 0 }]} />
          : undefined
      }
      actions={[
        {
          label: "Edit",
          icon: Pencil,
          variant: "outline",
          onClick: onEdit,
        },
        {
          label: "Delete",
          icon: Trash2,
          variant: "destructive",
          onClick: onDelete,
          hidden: () => !canDelete,
        },
      ]}
    />
  );
}
