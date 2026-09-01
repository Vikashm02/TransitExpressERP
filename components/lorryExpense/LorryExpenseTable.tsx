"use client";

import { Pencil, Trash2, Wallet } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import RelativeCreatedTime from "@/components/common/RelativeCreatedTime";
import StatusBadge from "@/components/ui/StatusBadge";
import type { LorryExpenseRecord } from "@/components/services/lorryExpense.service";
import {
  draftRowClassName,
  entryStatusBadgeStatus,
  entryStatusLabel,
  isDraftEntry,
} from "@/lib/entryStatus";

export interface LorryExpenseListRow extends LorryExpenseRecord {
  lrNumber: string;
  lrDate: string;
  consignor: string;
  consignee: string;
  vehicleNumber: string;
  billAmount: number;
  lorryHireAmount: number;
  totalExpenses: number;
  balancePayable: number;
  profitLoss: number;
  totalPaid: number;
}

interface LorryExpenseTableProps {
  rows: LorryExpenseListRow[];
  loading?: boolean;
  pageSize?: number;
  onEdit: (row: LorryExpenseListRow) => void;
  onContinueDraft: (row: LorryExpenseListRow) => void;
  onDelete: (row: LorryExpenseListRow) => void;
  canEdit?: boolean;
  canContinueDraft?: boolean;
  canDelete?: boolean;
}

function money(value: number): string {
  return `₹ ${value.toFixed(2)}`;
}

export default function LorryExpenseTable({
  rows,
  loading,
  pageSize,
  onEdit,
  onContinueDraft,
  onDelete,
  canEdit = true,
  canContinueDraft = true,
  canDelete = true,
}: LorryExpenseTableProps) {
  const columns: DataTableColumn<LorryExpenseListRow>[] = [
    { key: "lrNumber", header: "LR No.", sortable: true, className: "font-medium" },
    { key: "lrDate", header: "LR Date", sortable: true },
    {
      key: "expenseStatus",
      header: "Status",
      sortable: true,
      render: (row) => (
        <StatusBadge
          status={row.expenseStatus === "pending" ? "Pending" : "Completed"}
          label={row.expenseStatus === "pending" ? "Pending" : "Completed"}
        />
      ),
    },
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
    { key: "brokerName", header: "Broker", sortable: true },
    { key: "beneficiaryName", header: "Beneficiary", sortable: true },
    {
      key: "lorryHireAmount",
      header: "Lorry Hire",
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
      header: "Pending",
      align: "right",
      sortable: true,
      render: (row) => (
        <span
          className={
            row.balancePayable > 0
              ? "font-medium text-orange-700 dark:text-orange-400"
              : undefined
          }
        >
          {money(row.balancePayable)}
        </span>
      ),
    },
    {
      key: "profitLoss",
      header: "Profit / Loss",
      align: "right",
      sortable: true,
      render: (row) => money(row.profitLoss),
    },
    {
      key: "created_at",
      header: "Created",
      sortable: true,
      sortAccessor: (row) => row.created_at ?? "",
      render: (row) => <RelativeCreatedTime value={row.created_at} />,
    },
  ];

  function handleRowClick(row: LorryExpenseListRow) {
    if (isDraftEntry(row.entryStatus)) {
      if (canContinueDraft) onContinueDraft(row);
      return;
    }
    if (canEdit) onEdit(row);
  }

  return (
    <DataTable
      columns={columns}
      data={rows}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No Financials recorded"
      emptyDescription="Add Financials against an LR to track billing, hire and settlement."
      emptyIcon={Wallet}
      sortable
      defaultSort={{ key: "lrNumber", direction: "desc" }}
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
