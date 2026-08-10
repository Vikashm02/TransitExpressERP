"use client";

import { Banknote, Pencil, Trash2 } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import type { BillingPartyRecord } from "@/components/services/billingParty.service";

interface BillingPartyTableProps {
  billingParties: BillingPartyRecord[];
  loading?: boolean;
  pageSize?: number;
  onEdit: (billingParty: BillingPartyRecord) => void;
  onDelete: (billingParty: BillingPartyRecord) => void;
}

export default function BillingPartyTable({
  billingParties,
  loading,
  pageSize,
  onEdit,
  onDelete,
}: BillingPartyTableProps) {
  const columns: DataTableColumn<BillingPartyRecord>[] = [
    { key: "code", header: "Code", sortable: true, width: "10%" },
    { key: "name", header: "Billing Party", sortable: true, className: "font-medium" },
    { key: "gst", header: "GST" },
    { key: "mobile", header: "Mobile" },
    { key: "city", header: "City", sortable: true },
    { key: "status", header: "Status", type: "status", sortable: true },
  ];

  return (
    <DataTable
      columns={columns}
      data={billingParties}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No billing parties found"
      emptyDescription="Add your first billing party to get started."
      emptyIcon={Banknote}
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
