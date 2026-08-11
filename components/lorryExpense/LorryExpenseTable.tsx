"use client";

import { Pencil, Wallet } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import type { LorryExpenseRecord } from "@/components/services/lorryExpense.service";

export interface LorryExpenseListRow extends LorryExpenseRecord {
  lrNumber: string;
  consignor: string;
  consignee: string;
  vehicleNumber: string;
  lorryHireAmount: number;
  totalExpenses: number;
  balancePayable: number;
}

interface LorryExpenseTableProps {
  rows: LorryExpenseListRow[];
  loading?: boolean;
  pageSize?: number;
  onEdit: (row: LorryExpenseListRow) => void;
  /** Staff / Sub-User Access Control — hides Edit when the caller lacks
   * "lorry_expenses" edit permission. Defaults to `true` for existing
   * call sites. */
  canEdit?: boolean;
}

function money(value: number): string {
  return `₹ ${value.toFixed(2)}`;
}

export default function LorryExpenseTable({
  rows,
  loading,
  pageSize,
  onEdit,
  canEdit = true,
}: LorryExpenseTableProps) {
  const columns: DataTableColumn<LorryExpenseListRow>[] = [
    { key: "lrNumber", header: "LR No.", sortable: true, className: "font-medium" },
    { key: "consignor", header: "Consignor" },
    { key: "consignee", header: "Consignee" },
    { key: "vehicleNumber", header: "Vehicle" },
    {
      key: "lorryHireAmount",
      header: "Lorry Hire Amount",
      align: "right",
      sortable: true,
      render: (row) => money(row.lorryHireAmount),
    },
    {
      key: "totalExpenses",
      header: "Total Expenses",
      align: "right",
      sortable: true,
      render: (row) => money(row.totalExpenses),
    },
    {
      key: "balancePayable",
      header: "Balance Payable",
      align: "right",
      sortable: true,
      render: (row) => money(row.balancePayable),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No Lorry Expenses recorded"
      emptyDescription="Add expenses against an LR to track its lorry settlement."
      emptyIcon={Wallet}
      sortable
      defaultSort={{ key: "lrNumber", direction: "desc" }}
      pageSize={pageSize}
      actions={[
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
