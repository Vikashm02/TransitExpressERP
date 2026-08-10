"use client";

import { Eye, Pencil, Printer, ReceiptIndianRupee, Share2 } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import type { BillRecord } from "@/components/services/billing.service";

interface BillingTableProps {
  bills: BillRecord[];
  loading?: boolean;
  pageSize?: number;
  onView: (bill: BillRecord) => void;
  onEdit: (bill: BillRecord) => void;
  onPrint: (bill: BillRecord) => void;
  onShare: (bill: BillRecord) => void;
}

export default function BillingTable({
  bills,
  loading,
  pageSize,
  onView,
  onEdit,
  onPrint,
  onShare,
}: BillingTableProps) {
  const columns: DataTableColumn<BillRecord>[] = [
    { key: "billNumber", header: "Bill No.", sortable: true, className: "font-medium" },
    { key: "billDate", header: "Bill Date", sortable: true },
    { key: "billingPartyName", header: "Billing Party" },
    { key: "lrCount", header: "No. of LRs", align: "right", sortable: true },
    {
      key: "grandTotal",
      header: "Total Amount",
      align: "right",
      sortable: true,
      render: (row) => `₹ ${row.grandTotal.toFixed(2)}`,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={bills}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No bills found"
      emptyDescription="Create your first Bill from the unbilled LRs."
      emptyIcon={ReceiptIndianRupee}
      sortable
      defaultSort={{ key: "billDate", direction: "desc" }}
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
        {
          label: "Print",
          icon: Printer,
          variant: "outline",
          onClick: onPrint,
        },
        {
          label: "Share",
          icon: Share2,
          variant: "outline",
          onClick: onShare,
        },
      ]}
    />
  );
}
