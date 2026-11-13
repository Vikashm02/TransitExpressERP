"use client";

import { Banknote, Pencil, Trash2 } from "lucide-react";

import LrCountBadges from "@/components/common/LrCountBadges";
import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import RelativeCreatedTime from "@/components/common/RelativeCreatedTime";
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
  /** Saved LRs per record, shown as a badge in the action strip; hidden when undefined (see useLrUsageRows). */
  lrCounts?: Map<number, number>;
  /** Rows arrive already sorted by LR count (most first); skip the default sort. */
  sortByLrs?: boolean;
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
  lrCounts,
  sortByLrs = false,
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
    {
      key: "created_at",
      header: "Created",
      sortable: true,
      sortAccessor: (row) => row.created_at ?? "",
      render: (row) => <RelativeCreatedTime value={row.created_at} />,
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
      key={sortByLrs ? "lr-sort" : "default-sort"}
      columns={columns}
      data={billingParties}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No billing parties found"
      emptyDescription="Add your first billing party to get started."
      emptyIcon={Banknote}
      sortable
      defaultSort={sortByLrs ? undefined : { key: "name", direction: "asc" }}
      pageSize={pageSize}
      getRowClassName={(row) => draftRowClassName(row.entryStatus)}
      onRowClick={handleRowClick}
      actionsAside={
        lrCounts
          ? (row) => <LrCountBadges items={[{ label: "LRs", count: lrCounts.get(row.id) ?? 0 }]} />
          : undefined
      }
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
