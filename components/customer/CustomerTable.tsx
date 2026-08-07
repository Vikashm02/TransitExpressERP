"use client";

import { Pencil, Trash2, Users } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import type { CustomerRecord } from "@/components/services/customer.service";

interface CustomerTableProps {
  customers: CustomerRecord[];
  loading?: boolean;
  pageSize?: number;
  onEdit: (customer: CustomerRecord) => void;
  onDelete: (customer: CustomerRecord) => void;
}

export default function CustomerTable({
  customers,
  loading,
  pageSize,
  onEdit,
  onDelete,
}: CustomerTableProps) {
  const columns: DataTableColumn<CustomerRecord>[] = [
    { key: "code", header: "Code", sortable: true, width: "10%" },
    { key: "name", header: "Customer", sortable: true, className: "font-medium" },
    { key: "gst", header: "GST" },
    { key: "mobile", header: "Mobile" },
    { key: "city", header: "City", sortable: true },
    { key: "status", header: "Status", type: "status", sortable: true },
  ];

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
        },
      ]}
    />
  );
}
