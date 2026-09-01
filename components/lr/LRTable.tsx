"use client";

import {
  ClipboardCheck,
  Eye,
  FileText,
  Pencil,
  Plus,
  Printer,
  Share2,
  Trash2,
  UserCog,
} from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import RelativeCreatedTime from "@/components/common/RelativeCreatedTime";
import type { LRRecord } from "@/components/services/lr.service";
import {
  draftRowClassName,
  isDraftEntry,
  isDraftLrNumber,
} from "@/lib/entryStatus";
import { cn } from "@/lib/utils";

interface LRTableProps {
  lrs: LRRecord[];
  loading?: boolean;
  pageSize?: number;
  /** Open any visible LR in view mode. */
  onView: (lr: LRRecord) => void;
  onEdit: (lr: LRRecord) => void;
  /** Resume incomplete draft — must NOT require Edit permission. */
  onContinueDraft: (lr: LRRecord) => void;
  onDelete: (lr: LRRecord) => void;
  onPrint: (lr: LRRecord) => void;
  onShare: (lr: LRRecord) => void;
  isAdmin?: boolean;
  onReassign?: (lr: LRRecord) => void;
  resolveAssignedName?: (assignedTo: string | null) => string;
  canEdit?: boolean;
  /** Create or Edit — required to open/continue a draft row. */
  canContinueDraft?: boolean;
  canDelete?: boolean;
  canPrint?: boolean;
  canShare?: boolean;
  /** Open Consignee Intelligence for the exact consignee name on this row. */
  onConsigneeClick?: (lr: LRRecord) => void;
  /** Open Material Intelligence for the exact material name on this row. */
  onMaterialClick?: (lr: LRRecord) => void;
  /**
   * Derived POD presence: lr_number → pods.id.
   * Read-only lookup from existing POD rows; never written onto LRs.
   */
  podIdByLrNumber?: ReadonlyMap<string, number>;
  canCreatePod?: boolean;
  canEditPod?: boolean;
  onCreatePod?: (lr: LRRecord) => void;
  onViewPod?: (lr: LRRecord) => void;
  onEditPod?: (lr: LRRecord) => void;
}

function displayLrNumber(row: LRRecord): string {
  if (row.lrNumber?.trim() && !isDraftLrNumber(row.lrNumber)) {
    return row.lrNumber;
  }
  if (isDraftEntry(row.entryStatus)) return "—";
  return row.lrNumber || "—";
}

/** Same eligibility rules as POD autocomplete: finalized LR with a real number. */
function canOfferCreatePod(row: LRRecord): boolean {
  return (
    !isDraftEntry(row.entryStatus) &&
    Boolean(row.lrNumber?.trim()) &&
    !isDraftLrNumber(row.lrNumber)
  );
}

/**
 * Compact POD status for the LR list (presentation only).
 * Sits at the bottom of the LR No. cell, above the action strip.
 * Theme-aware semantic accents — readable in light and dark mode.
 */
function PodStatusChip({ hasPod }: { hasPod: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit max-w-full items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none ring-1",
        hasPod
          ? "bg-success/15 text-success ring-success/30 dark:bg-success/25 dark:text-success dark:ring-success/45"
          : "bg-warning/20 text-warning ring-warning/35 dark:bg-warning/30 dark:text-warning dark:ring-warning/50"
      )}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      {hasPod ? "POD Created" : "POD Pending"}
    </span>
  );
}

export default function LRTable({
  lrs,
  loading,
  pageSize,
  onView,
  onEdit,
  onContinueDraft,
  onDelete,
  onPrint,
  onShare,
  isAdmin = false,
  onReassign,
  resolveAssignedName,
  canEdit = true,
  canContinueDraft = true,
  canDelete = true,
  canPrint = true,
  canShare = true,
  onConsigneeClick,
  onMaterialClick,
  podIdByLrNumber,
  canCreatePod = false,
  canEditPod = false,
  onCreatePod,
  onViewPod,
  onEditPod,
}: LRTableProps) {
  const columns: DataTableColumn<LRRecord>[] = [
    {
      key: "lrNumber",
      header: "LR No.",
      className: "align-top font-medium",
      render: (row) => {
        const number = displayLrNumber(row);
        const key = row.lrNumber?.trim() ?? "";
        const hasPod = Boolean(key && podIdByLrNumber?.has(key));
        return (
          <div className="flex min-h-[3.5rem] min-w-0 flex-col items-start justify-between gap-2 py-0.5">
            <span className="truncate font-medium leading-tight">{number}</span>
            {podIdByLrNumber ? <PodStatusChip hasPod={hasPod} /> : null}
          </div>
        );
      },
    },
    { key: "lrDate", header: "Date" },
    { key: "consignor", header: "Consignor" },
    {
      key: "consignee",
      header: "Consignee",
      render: (row) => {
        const name = (row.consignee || "").trim();
        if (!name) return "—";
        if (!onConsigneeClick) return name;
        return (
          <button
            type="button"
            className="text-left font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => {
              event.stopPropagation();
              onConsigneeClick(row);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.stopPropagation();
              }
            }}
          >
            {name}
          </button>
        );
      },
    },
    {
      key: "material",
      header: "Material",
      render: (row) => {
        const name = (row.material || "").trim();
        if (!name) return "—";
        if (!onMaterialClick) return name;
        return (
          <button
            type="button"
            className="text-left font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => {
              event.stopPropagation();
              onMaterialClick(row);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.stopPropagation();
              }
            }}
          >
            {name}
          </button>
        );
      },
    },
    { key: "vehicleNumber", header: "Vehicle" },
    {
      key: "route",
      header: "Route",
      render: (row) => `${row.from || "—"} → ${row.to || "—"}`,
    },
    { key: "status", header: "Status", type: "status" },
    {
      key: "createdBy",
      header: "Created By",
      render: (row) =>
        row.createdBy
          ? resolveAssignedName?.(row.createdBy) ?? "Unknown"
          : "—",
    },
    {
      key: "created_at",
      header: "Created",
      render: (row) => <RelativeCreatedTime value={row.created_at} />,
    },
  ];

  // Assigned To is intentionally NOT shown on the landing page (horizontal
  // space). Reassign remains available in the action bar; assignment data
  // and service logic are unchanged.

  // Fixed dashboard order: numeric LR number descending (never lexicographic).
  // e.g. LR19311 > LR19310 > … > LR1932 > LR1931. No alternate column sorts.
  const orderedLrs = [...lrs].sort((a, b) => {
    const numA = Number(String(a.lrNumber || "").replace(/\D/g, "")) || 0;
    const numB = Number(String(b.lrNumber || "").replace(/\D/g, "")) || 0;
    return numB - numA;
  });

  return (
    <DataTable
      columns={columns}
      data={orderedLrs}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No LRs found"
      emptyDescription="Create your first Lorry Receipt to get started."
      emptyIcon={FileText}
      pageSize={pageSize}
      getRowClassName={(row) => draftRowClassName(row.entryStatus)}
      onRowClick={onView}
      actions={[
        {
          label: "View",
          icon: Eye,
          variant: "outline",
          onClick: onView,
        },
        {
          label: "Print",
          icon: Printer,
          variant: "outline",
          onClick: onPrint,
          hidden: (row) => !canPrint || isDraftEntry(row.entryStatus),
        },
        {
          label: "Share",
          icon: Share2,
          variant: "outline",
          onClick: onShare,
          hidden: (row) => !canShare || isDraftEntry(row.entryStatus),
        },
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
          label: "Create POD",
          icon: Plus,
          variant: "outline",
          onClick: (row) => onCreatePod?.(row),
          hidden: (row) => {
            if (!canCreatePod || !onCreatePod) return true;
            if (!canOfferCreatePod(row)) return true;
            const key = row.lrNumber?.trim() ?? "";
            return Boolean(key && podIdByLrNumber?.has(key));
          },
        },
        {
          label: "Edit POD",
          icon: ClipboardCheck,
          variant: "outline",
          onClick: (row) => onEditPod?.(row),
          hidden: (row) => {
            if (!canEditPod || !onEditPod) return true;
            const key = row.lrNumber?.trim() ?? "";
            return !(key && podIdByLrNumber?.has(key));
          },
        },
        {
          label: "View POD",
          icon: ClipboardCheck,
          variant: "outline",
          onClick: (row) => onViewPod?.(row),
          hidden: (row) => {
            // Prefer Edit POD when the user can edit; otherwise View if they
            // have any POD module access (create_view or edit).
            if (canEditPod) return true;
            if (!canCreatePod || !onViewPod) return true;
            const key = row.lrNumber?.trim() ?? "";
            return !(key && podIdByLrNumber?.has(key));
          },
        },
        {
          label: "Delete",
          icon: Trash2,
          variant: "destructive",
          onClick: onDelete,
          hidden: () => !canDelete,
        },
        ...(isAdmin && onReassign
          ? [
              {
                label: "Reassign",
                icon: UserCog,
                variant: "outline" as const,
                onClick: onReassign,
                hidden: (row: LRRecord) => isDraftEntry(row.entryStatus) || !canEdit,
              },
            ]
          : []),
      ]}
    />
  );
}
