"use client";

import { Eye, FilePlus2, Pencil } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import type { DebitNoteRecord } from "@/components/services/debitNote.service";
import { formatGstOption } from "@/lib/gstOptions";

interface DebitNoteTableProps {
  debitNotes: DebitNoteRecord[];
  loading?: boolean;
  pageSize?: number;
  onView: (debitNote: DebitNoteRecord) => void;
  onEdit: (debitNote: DebitNoteRecord) => void;
}

export default function DebitNoteTable({
  debitNotes,
  loading,
  pageSize,
  onView,
  onEdit,
}: DebitNoteTableProps) {
  const columns: DataTableColumn<DebitNoteRecord>[] = [
    { key: "debitNoteNumber", header: "Debit Note No.", sortable: true, className: "font-medium" },
    { key: "noteDate", header: "Date", sortable: true },
    { key: "billingPartyName", header: "Billing Party" },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sortable: true,
      render: (row) => `₹ ${row.amount.toFixed(2)}`,
    },
    {
      key: "gstPercentage",
      header: "GST",
      align: "right",
      render: (row) => formatGstOption(row.gstPercentage),
    },
    {
      key: "totalAmount",
      header: "Total",
      align: "right",
      sortable: true,
      render: (row) => `₹ ${row.totalAmount.toFixed(2)}`,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={debitNotes}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No debit notes found"
      emptyDescription="Create a Debit Note to record an amount debited against a Billing Party."
      emptyIcon={FilePlus2}
      sortable
      defaultSort={{ key: "noteDate", direction: "desc" }}
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
