"use client";

import { Eye, FileMinus2, Pencil } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import type { CreditNoteRecord } from "@/components/services/creditNote.service";

interface CreditNoteTableProps {
  creditNotes: CreditNoteRecord[];
  loading?: boolean;
  pageSize?: number;
  onView: (creditNote: CreditNoteRecord) => void;
  onEdit: (creditNote: CreditNoteRecord) => void;
  /** Staff / Sub-User Access Control — hides Edit when the caller lacks
   * "credit_notes" edit permission. Defaults to `true` for existing
   * call sites. */
  canEdit?: boolean;
}

export default function CreditNoteTable({
  creditNotes,
  loading,
  pageSize,
  onView,
  onEdit,
  canEdit = true,
}: CreditNoteTableProps) {
  const columns: DataTableColumn<CreditNoteRecord>[] = [
    { key: "creditNoteNumber", header: "Credit Note No.", sortable: true, className: "font-medium" },
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
      key: "deduction",
      header: "Discount/Deduction",
      align: "right",
      render: (row) => `₹ ${row.deduction.toFixed(2)}`,
    },
    {
      key: "netAmount",
      header: "Net Credit",
      align: "right",
      sortable: true,
      render: (row) => `₹ ${row.netAmount.toFixed(2)}`,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={creditNotes}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No credit notes found"
      emptyDescription="Create a Credit Note against a Billing Party to record a deduction/discount."
      emptyIcon={FileMinus2}
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
          hidden: () => !canEdit,
        },
      ]}
    />
  );
}
