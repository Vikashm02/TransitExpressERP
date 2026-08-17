"use client";

import { Banknote, Pencil, Trash2 } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import StatusBadge from "@/components/ui/StatusBadge";
import type { BillingPartyRecord } from "@/components/services/billingParty.service";
import {
  draftRowClassName,
  entryStatusBadgeStatus,
  entryStatusLabel,
  isDraftEntry,
} from "@/lib/entryStatus";

interface BillingPartyTableProps {
  billingParties: BillingPartyRecord[];
  loading?: boolean;
  pageSize?: number;
  onEdit: (billingParty: BillingPartyRecord) => void;
  onContinueDraft: (billingParty: BillingPartyRecord) => void;
  onDelete: (billingParty: BillingPartyRecord) => void;
  canEdit?: boolean;
  canContinueDraft?: boolean;
  canDelete?: boolean;
}

export default function BillingPartyTable({
  billingParties,
  loading,
  pageSize,
  onEdit,
  onContinueDraft,
  onDelete,
  canEdit = true,
  canContinueDraft = true,
  canDelete = true,
}: BillingPartyTableProps) {
  const columns: DataTableColumn<BillingPartyRecord>[] = [
    { key: "code", header: "Code", sortable: true, width: "10%" },
    { key: "name", header: "Billing Party", sortable: true, className: "font-medium" },
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
  ];

  function handleRowClick(row: BillingPartyRecord) {
    if (isDraftEntry(row.entryStatus)) {
      if (canContinueDraft) onContinueDraft(row);
      return;
    }
    if (canEdit) onEdit(row);
  }

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
