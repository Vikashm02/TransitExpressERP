"use client";

import { ClipboardList, Eye, Pencil, Printer, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import RelativeCreatedTime from "@/components/common/RelativeCreatedTime";
import type { AsnRecord } from "@/components/services/asn.service";

interface AsnTableProps {
  asns: AsnRecord[];
  loading?: boolean;
  pageSize?: number;
  onView: (asn: AsnRecord) => void;
  onEdit: (asn: AsnRecord) => void;
  onPrint: (asn: AsnRecord) => void;
  onDelete: (asn: AsnRecord) => void;
  /** Hides Edit when the caller lacks asn_creations edit permission. */
  canEdit?: boolean;
  /** Hides Delete when the caller lacks asn_creations delete action. */
  canDelete?: boolean;
  /** Hides Print when the caller lacks asn_creations print action. */
  canPrint?: boolean;
}

function formatEta(value: string): string {
  if (!value) return "";
  try {
    const d = parseISO(value);
    return format(d, "dd-MM-yyyy HH:mm");
  } catch {
    return value;
  }
}

export default function AsnTable({
  asns,
  loading,
  pageSize,
  onView,
  onEdit,
  onPrint,
  onDelete,
  canEdit = true,
  canDelete = true,
  canPrint = true,
}: AsnTableProps) {
  const columns: DataTableColumn<AsnRecord>[] = [
    { key: "asnNumber", header: "ASN Number", sortable: true, className: "font-medium" },
    { key: "asnDate", header: "ASN Date", sortable: true },
    { key: "lrNumber", header: "LR Number", sortable: true },
    { key: "vehicleNumber", header: "Vehicle Number", sortable: true },
    {
      key: "expectedTimeOfArrival",
      header: "Expected Arrival",
      sortable: true,
      render: (row) => formatEta(row.expectedTimeOfArrival),
    },
    {
      key: "created_at",
      header: "Created",
      sortable: true,
      sortAccessor: (row) => row.created_at ?? "",
      render: (row) => <RelativeCreatedTime value={row.created_at} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={asns}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No ASNs found"
      emptyDescription="Create your first ASN from an existing LR."
      emptyIcon={ClipboardList}
      sortable
      defaultSort={{ key: "asnDate", direction: "desc" }}
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
        {
          label: "Print",
          icon: Printer,
          variant: "outline",
          onClick: onPrint,
          hidden: () => !canPrint,
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
