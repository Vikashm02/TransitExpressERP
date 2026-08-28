"use client";

import { Package, Pencil, Trash2 } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import type { MaterialRecord } from "@/components/services/material.service";

interface MaterialTableProps {
  materials: MaterialRecord[];
  loading?: boolean;
  pageSize?: number;
  onEdit: (material: MaterialRecord) => void;
  onDelete: (material: MaterialRecord) => void;
  /** Delete is admin-only (migration 047). */
  canDelete?: boolean;
}

export default function MaterialTable({
  materials,
  loading,
  pageSize,
  onEdit,
  onDelete,
  canDelete = false,
}: MaterialTableProps) {
  const columns: DataTableColumn<MaterialRecord>[] = [
    { key: "code", header: "Material Code", sortable: true, width: "12%" },
    { key: "materialName", header: "Material Name", sortable: true, className: "font-medium" },
    { key: "category", header: "Category", sortable: true },
    { key: "hsnCode", header: "HSN Code" },
    { key: "status", header: "Status", type: "status", sortable: true },
  ];

  return (
    <DataTable
      columns={columns}
      data={materials}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No materials found"
      emptyDescription="Add your first material to get started."
      emptyIcon={Package}
      sortable
      defaultSort={{ key: "materialName", direction: "asc" }}
      pageSize={pageSize}
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
