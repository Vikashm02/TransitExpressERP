"use client";

import { Pencil, Trash2, Truck } from "lucide-react";

import { vehicleKey } from "@/lib/masterLrCounts";
import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import RelativeCreatedTime from "@/components/common/RelativeCreatedTime";
import StatusBadge from "@/components/ui/StatusBadge";
import { getComplianceStatus } from "./vehicle.schema";
import type { VehicleRecord } from "@/components/services/vehicle.service";

interface VehicleTableProps {
  vehicles: VehicleRecord[];
  loading?: boolean;
  pageSize?: number;
  onEdit: (vehicle: VehicleRecord) => void;
  onDelete: (vehicle: VehicleRecord) => void;
  /** Hides Edit when the caller lacks vehicle edit permission. */
  canEdit?: boolean;
  /** Delete is Creator-only (migrations 047/048). */
  canDelete?: boolean;
  /** Saved LRs per record; column hidden when undefined (see useLrUsageRows). */
  lrCounts?: Map<string, number>;
}

export default function VehicleTable({
  vehicles,
  loading,
  pageSize,
  onEdit,
  onDelete,
  canEdit = true,
  canDelete = false,
  lrCounts,
}: VehicleTableProps) {
  const columns: DataTableColumn<VehicleRecord>[] = [
    { key: "vehicleNumber", header: "Vehicle Number", sortable: true, className: "font-medium" },
    { key: "vehicleType", header: "Vehicle Type", sortable: true },
    { key: "transporter", header: "Transporter", sortable: true },
    { key: "driverName", header: "Driver", sortable: true },
    { key: "driverMobile", header: "Driver Mobile" },
    { key: "ownerName", header: "Owner", sortable: true },
    { key: "ownerType", header: "Owner Type" },
    {
      key: "capacity",
      header: "Capacity",
      render: (row) => (row.capacity ? `${row.capacity} ${row.capacityUnit}` : "—"),
    },
    { key: "mobile", header: "Owner Mobile" },
    {
      key: "complianceStatus",
      header: "Compliance Status",
      sortable: true,
      sortAccessor: (row) => getComplianceStatus(row),
      render: (row) => <StatusBadge status={getComplianceStatus(row)} />,
    },
    { key: "status", header: "Status", type: "status", sortable: true },
    {
      key: "created_at",
      header: "Created",
      sortable: true,
      sortAccessor: (row) => row.created_at ?? "",
      render: (row) => <RelativeCreatedTime value={row.created_at} />,
    },
    ...(lrCounts
      ? [
          {
            key: "lrCount",
            header: "LRs",
            align: "right" as const,
            sortable: true,
            sortAccessor: (row: VehicleRecord) => lrCounts.get(vehicleKey(row.vehicleNumber)) ?? 0,
            render: (row: VehicleRecord) => lrCounts.get(vehicleKey(row.vehicleNumber)) ?? 0,
          },
        ]
      : []),
  ];

  return (
    <DataTable
      columns={columns}
      data={vehicles}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No vehicles found"
      emptyDescription="Add your first vehicle to get started."
      emptyIcon={Truck}
      sortable
      defaultSort={{ key: "vehicleNumber", direction: "asc" }}
      pageSize={pageSize}
      actions={[
        {
          label: "Edit",
          icon: Pencil,
          variant: "outline",
          onClick: onEdit,
          hidden: () => !canEdit,
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
