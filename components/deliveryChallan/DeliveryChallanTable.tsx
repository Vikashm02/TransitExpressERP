"use client";

import { Eye, FileStack, Pencil, Printer, Share2 } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import RelativeCreatedTime from "@/components/common/RelativeCreatedTime";
import type { DeliveryChallanRecord } from "@/components/services/deliveryChallan.service";
import { canStaffEditRecord } from "@/lib/editWindow";

interface DeliveryChallanTableProps {
  challans: DeliveryChallanRecord[];
  loading?: boolean;
  pageSize?: number;
  onView: (challan: DeliveryChallanRecord) => void;
  onEdit: (challan: DeliveryChallanRecord) => void;
  onPrint: (challan: DeliveryChallanRecord) => void;
  onShare: (challan: DeliveryChallanRecord) => void;
  canEdit?: boolean;
  canPrint?: boolean;
  canShare?: boolean;
  /** Creator/Admin bypass for the 48-hour staff edit window (matches DB is_admin()). */
  isAdmin?: boolean;
}

export default function DeliveryChallanTable({
  challans,
  loading,
  pageSize,
  onView,
  onEdit,
  onPrint,
  onShare,
  canEdit = true,
  canPrint = true,
  canShare = true,
  isAdmin = true,
}: DeliveryChallanTableProps) {
  const columns: DataTableColumn<DeliveryChallanRecord>[] = [
    { key: "lrNumber", header: "LR Number", sortable: true, className: "font-medium" },
    { key: "lrDate", header: "LR Date", sortable: true },
    { key: "consignor", header: "Dispatch From", sortable: true },
    { key: "consignee", header: "Dispatch To", sortable: true },
    { key: "vehicleNumber", header: "Vehicle No", sortable: true },
    {
      key: "qty",
      header: "QTY",
      sortable: true,
      render: (row) => Number(row.qty).toFixed(3),
    },
    { key: "poNumber", header: "PO No", sortable: true },
    { key: "hsn", header: "HSN", sortable: true },
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
      data={challans}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No Delivery Challans found"
      emptyDescription="Create your first Delivery Challan from an existing LR."
      emptyIcon={FileStack}
      sortable
      defaultSort={{ key: "lrDate", direction: "desc" }}
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
          hidden: (row) => !canStaffEditRecord(isAdmin, canEdit, row),
        },
        {
          label: "Print",
          icon: Printer,
          variant: "outline",
          onClick: onPrint,
          hidden: () => !canPrint,
        },
        {
          label: "Share",
          icon: Share2,
          variant: "outline",
          onClick: onShare,
          hidden: () => !canShare,
        },
      ]}
    />
  );
}
