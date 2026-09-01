"use client";

import { Pencil, Trash2, Users } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import RelativeCreatedTime from "@/components/common/RelativeCreatedTime";
import StatusBadge from "@/components/ui/StatusBadge";
import type { CustomerRecord } from "@/components/services/customer.service";
import {
  draftRowClassName,
  entryStatusBadgeStatus,
  entryStatusLabel,
  isDraftEntry,
} from "@/lib/entryStatus";

interface CustomerTableProps {
  customers: CustomerRecord[];
  loading?: boolean;
  pageSize?: number;
  onEdit: (customer: CustomerRecord) => void;
  onContinueDraft: (customer: CustomerRecord) => void;
  onDelete: (customer: CustomerRecord) => void;
  canEdit?: boolean;
  canContinueDraft?: boolean;
  canDelete?: boolean;
}

export default function CustomerTable({
  customers,
  loading,
  pageSize,
  onEdit,
  onContinueDraft,
  onDelete,
  canEdit = true,
  canContinueDraft = true,
  canDelete = true,
}: CustomerTableProps) {
  const columns: DataTableColumn<CustomerRecord>[] = [
    { key: "code", header: "Code", sortable: true, width: "10%" },
    { key: "name", header: "Customer", sortable: true, className: "font-medium" },
    { key: "gst", header: "GST" },
    { key: "mobile", header: "Mobile" },
    { key: "city", header: "City", sortable: true },
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
    {
      key: "created_at",
      header: "Created",
      sortable: true,
      sortAccessor: (row) => row.created_at ?? "",
      render: (row) => <RelativeCreatedTime value={row.created_at} />,
    },
  ];

  function handleRowClick(row: CustomerRecord) {
    if (isDraftEntry(row.entryStatus)) {
      if (canContinueDraft) onContinueDraft(row);
      return;
    }
    if (canEdit) onEdit(row);
  }

  return (
    <DataTable
      columns={columns}
      data={customers}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No customers found"
      emptyDescription="Add your first customer to get started."
      emptyIcon={Users}
      sortable
      defaultSort={{ key: "name", direction: "asc" }}
      pageSize={pageSize}
      getRowClassName={(row) => draftRowClassName(row.entryStatus)}
      onRowClick={handleRowClick}
      actions={[
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
      ]}
    />
  );
}
