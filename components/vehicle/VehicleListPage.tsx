"use client";

import { useEffect, useMemo, useState } from "react";
import { createdOnColumn, exportCsv, type ExportColumn } from "@/lib/exportColumns";
import { matchesListSearch } from "@/lib/listSearch";
import { toast } from "sonner";
import { getUserFacingError } from "@/lib/errors/getUserFacingError";
import { FileDown, Upload } from "lucide-react";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import VehicleDialog from "./VehicleDialog";
import VehicleBulkUploadDialog from "./VehicleBulkUploadDialog";
import VehicleTable from "./VehicleTable";
import { VEHICLE_STATUS_OPTIONS, type Vehicle } from "./vehicle.schema";
import { downloadVehicleUploadTemplate } from "./vehicleBulkUpload";

import {
  createVehicle,
  deleteVehicle,
  getVehicles,
  updateVehicle,
  type VehicleRecord,
} from "@/components/services/vehicle.service";
import { useAuth } from "@/lib/auth/AuthProvider";
import { vehicleNumberMatchesQuery } from "@/lib/vehicleNumber";

/** Export = Add/Edit form fields in form order (keep in sync with the form). */
const VEHICLE_EXPORT_COLUMNS: ExportColumn<VehicleRecord>[] = [
  { header: "Vehicle Number", value: (r) => r.vehicleNumber },
  { header: "RC Number", value: (r) => r.rcNumber },
  { header: "Vehicle Type", value: (r) => r.vehicleType },
  { header: "Owner Type", value: (r) => r.ownerType },
  { header: "Owner Name", value: (r) => r.ownerName },
  { header: "Mobile Number", value: (r) => r.mobile },
  { header: "Transporter", value: (r) => r.transporter },
  { header: "Driver Name", value: (r) => r.driverName },
  { header: "Driver Mobile", value: (r) => r.driverMobile },
  { header: "Capacity", value: (r) => r.capacity },
  { header: "Capacity Unit", value: (r) => r.capacityUnit },
  { header: "Hire Rate", value: (r) => r.hireRate },
  { header: "Hire Type", value: (r) => r.hireType },
  { header: "Chassis Number", value: (r) => r.chassisNumber },
  { header: "Engine Number", value: (r) => r.engineNumber },
  { header: "Insurance Number", value: (r) => r.insuranceNumber },
  { header: "Insurance Expiry", value: (r) => r.insuranceExpiry },
  { header: "Permit Number", value: (r) => r.permitNumber },
  { header: "Permit Expiry", value: (r) => r.permitExpiry },
  { header: "Fitness Number", value: (r) => r.fitnessNumber },
  { header: "Fitness Expiry", value: (r) => r.fitnessExpiry },
  { header: "PUC Number", value: (r) => r.pucNumber },
  { header: "PUC Expiry", value: (r) => r.pucExpiry },
  { header: "Status", value: (r) => r.status },
  { header: "Remarks", value: (r) => r.remarks },
  createdOnColumn((r) => r.created_at),
];

const PAGE_SIZE = 10;

export default function VehicleListPage() {
  const { hasPermission, isCreator } = useAuth();
  const canCreate = hasPermission("vehicle", "create_view");
  const canEdit = hasPermission("vehicle", "edit");
  const canDelete = isCreator;

  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<VehicleRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<VehicleRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);

  useEffect(() => {
    loadVehicles();
  }, []);

  async function loadVehicles() {
    try {
      setLoading(true);
      const data = await getVehicles();
      setVehicles(data);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load vehicles.");
    } finally {
      setLoading(false);
    }
  }

  const filteredVehicles = useMemo(() => {
    const query = search.trim();

    return vehicles.filter((vehicle) => {
      const matchesSearch =
        !query ||
        vehicleNumberMatchesQuery(vehicle.vehicleNumber, query) ||
        matchesListSearch(query, [
          vehicle.vehicleNumber,
          vehicle.vehicleType,
          vehicle.transporter,
          vehicle.driverName,
          vehicle.driverMobile,
          vehicle.ownerName,
          vehicle.ownerType,
          vehicle.capacity,
          vehicle.mobile,
          vehicle.rcNumber,
          vehicle.chassisNumber,
          vehicle.status,
        ]);

      const matchesStatus = !statusFilter || vehicle.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [vehicles, search, statusFilter]);

  function handleAdd() {
    setEditingVehicle(null);
    setDialogOpen(true);
  }

  function handleEdit(vehicle: VehicleRecord) {
    setEditingVehicle(vehicle);
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) setEditingVehicle(null);
  }

  async function handleSubmit(values: Vehicle) {
    try {
      setSaving(true);

      if (editingVehicle) {
        await updateVehicle(editingVehicle.id, values);
        toast.success("Vehicle updated successfully.");
      } else {
        await createVehicle(values);
        toast.success("Vehicle created successfully.");
      }

      setDialogOpen(false);
      setEditingVehicle(null);
      await loadVehicles();
    } catch (error) {
      console.error(error);
      toast.error(getUserFacingError(error, editingVehicle ? "Unable to update vehicle." : "Unable to create vehicle."));
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;

    try {
      setDeleting(true);
      await deleteVehicle(deleteTarget.id);
      toast.success("Vehicle deleted successfully.");
      setDeleteTarget(null);
      await loadVehicles();
    } catch (error) {
      console.error(error);
      toast.error(getUserFacingError(error, "Unable to delete vehicle."));
    } finally {
      setDeleting(false);
    }
  }

  function handleExport() {
    exportCsv("vehicles", VEHICLE_EXPORT_COLUMNS, filteredVehicles);
  }


  async function handleDownloadTemplate() {
    try {
      await downloadVehicleUploadTemplate();
    } catch (error) {
      console.error(error);
      toast.error("Unable to generate the upload template.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicle Master"
        buttonText="Add Vehicle"
        onAdd={handleAdd}
        showAddButton={canCreate}
      />

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search vehicle no., type, transporter, driver, owner, mobile, status..."
        onRefresh={loadVehicles}
        onExport={handleExport}
        actions={[
          {
            key: "download-template",
            label: "Download Template",
            icon: FileDown,
            onClick: handleDownloadTemplate,
          },
          {
            key: "bulk-upload",
            label: "Bulk Upload",
            icon: Upload,
            onClick: () => setBulkUploadOpen(true),
          },
        ]}
        filters={[
          {
            key: "status",
            label: "Status",
            value: statusFilter,
            placeholder: "All statuses",
            options: VEHICLE_STATUS_OPTIONS.map((status) => ({
              label: status,
              value: status,
            })),
            onChange: setStatusFilter,
          },
        ]}
      />

      <VehicleTable
        vehicles={filteredVehicles}
        loading={loading}
        pageSize={PAGE_SIZE}
        onEdit={handleEdit}
        onDelete={setDeleteTarget}
        canEdit={canEdit}
        canDelete={canDelete}
      />

      <VehicleDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        vehicle={editingVehicle}
        loading={saving}
        onSubmit={handleSubmit}
      />

      <VehicleBulkUploadDialog
        open={bulkUploadOpen}
        onOpenChange={setBulkUploadOpen}
        existingVehicles={vehicles}
        onImported={loadVehicles}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete vehicle"
        description={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.vehicleNumber}"? This action cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        variant="destructive"
        loading={deleting}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
