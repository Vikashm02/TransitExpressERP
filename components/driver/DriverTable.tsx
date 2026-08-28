"use client";

import { Pencil, Trash2, User } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import StatusBadge from "@/components/ui/StatusBadge";
import { getLicenseStatus } from "./driver.schema";
import type { DriverRecord } from "@/components/services/driver.service";

interface DriverTableProps {
  drivers: DriverRecord[];
  loading?: boolean;
  pageSize?: number;
  onEdit: (driver: DriverRecord) => void;
  onDelete: (driver: DriverRecord) => void;
  /** Delete is Creator-only (migrations 047/048). */
  canDelete?: boolean;
}

export default function DriverTable({
  drivers,
  loading,
  pageSize,
  onEdit,
  onDelete,
  canDelete = false,
}: DriverTableProps) {
  const columns: DataTableColumn<DriverRecord>[] = [
    { key: "driverName", header: "Driver Name", sortable: true, className: "font-medium" },
    { key: "mobile", header: "Mobile" },
    { key: "licenseNumber", header: "License Number", sortable: true },
    { key: "driverType", header: "Driver Type", sortable: true },
    {
      key: "licenseStatus",
      header: "License Status",
      sortable: true,
      sortAccessor: (row) => getLicenseStatus(row),
      render: (row) => <StatusBadge status={getLicenseStatus(row)} />,
    },
    { key: "status", header: "Status", type: "status", sortable: true },
  ];

  return (
    <DataTable
      columns={columns}
      data={drivers}
      rowKey={(row) => row.id}
      loading={loading}
      emptyTitle="No drivers found"
      emptyDescription="Add your first driver to get started."
      emptyIcon={User}
      sortable
      defaultSort={{ key: "driverName", direction: "asc" }}
      pageSize={pageSize}
      actions={[
        {
          label: "Edit",
          icon: Pencil,
          variant: "outline",
          onClick: onEdit,
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
