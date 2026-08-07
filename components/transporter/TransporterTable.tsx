"use client";

import { Pencil, Trash2, Truck } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import type { TransporterRecord } from "@/components/services/transporter.service";

interface TransporterTableProps {
  transporters: TransporterRecord[];
  loading?: boolean;
  pageSize?: number;
  onEdit: (transporter: TransporterRecord) => void;
  onDelete: (transporter: TransporterRecord) => void;
}

export default function TransporterTable({
  transporters,
  loading,
  pageSize,
  onEdit,
  onDelete,
}: TransporterTableProps) {
  const columns: DataTableColumn<TransporterRecord>[] = [
    { key: "code", header: "Code", sortable: true, width: "10%" },
    { key: "transporterName", header: "Transporter", sortable: true, className: "font-medium" },
    { key: "transporterType", header: "Type", sortable: true },
    { key: "contactPerson", header: "Contact Person" },
    { key: "mobile", header: "Mobile" },
    { key: "gstin", header: "GSTIN" },
    { key: "paymentTerm", header: "Payment Term", sortable: true },
    { key: "status", header: "Status", type: "status", sortable: true },
  ];

  return (
    <DataTable
      columns={columns}
      data={transporters}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No transporters found"
      emptyDescription="Add your first transporter to get started."
      emptyIcon={Truck}
      sortable
      defaultSort={{ key: "transporterName", direction: "asc" }}
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
