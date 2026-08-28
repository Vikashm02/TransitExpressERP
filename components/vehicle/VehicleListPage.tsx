"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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

const PAGE_SIZE = 10;

export default function VehicleListPage() {
  const { hasPermission, isAdmin } = useAuth();
  const canCreate = hasPermission("vehicle", "create_view");
  const canEdit = hasPermission("vehicle", "edit");
  const canDelete = isAdmin;

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
        [vehicle.ownerName, vehicle.mobile, vehicle.rcNumber, vehicle.chassisNumber]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(query.toLowerCase()));

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
      toast.error(
        editingVehicle
          ? "Unable to update vehicle."
          : "Unable to create vehicle."
      );
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
      toast.error("Unable to delete vehicle.");
    } finally {
      setDeleting(false);
    }
  }

  function handleExport() {
    const headers = [
      "Vehicle Number",
      "RC Number",
      "Vehicle Type",
      "Owner Name",
      "Owner Type",
      "Mobile",
      "Capacity",
      "Capacity Unit",
      "Hire Rate",
      "Hire Type",
      "Chassis Number",
      "Engine Number",
      "Insurance Number",
      "Insurance Expiry",
      "Permit Number",
      "Permit Expiry",
      "Fitness Number",
      "Fitness Expiry",
      "PUC Number",
      "PUC Expiry",
      "Remarks",
      "Status",
    ];

    const rows = filteredVehicles.map((vehicle) => [
      vehicle.vehicleNumber,
      vehicle.rcNumber,
      vehicle.vehicleType,
      vehicle.ownerName,
      vehicle.ownerType,
      vehicle.mobile,
      vehicle.capacity,
      vehicle.capacityUnit,
      vehicle.hireRate,
      vehicle.hireType,
      vehicle.chassisNumber,
      vehicle.engineNumber,
      vehicle.insuranceNumber,
      vehicle.insuranceExpiry,
      vehicle.permitNumber,
      vehicle.permitExpiry,
      vehicle.fitnessNumber,
      vehicle.fitnessExpiry,
      vehicle.pucNumber,
      vehicle.pucExpiry,
      vehicle.remarks,
      vehicle.status,
    ]);

    const csv = [headers, ...rows]
      .map((row) =>
        row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "vehicles.csv";
    link.click();
    URL.revokeObjectURL(url);
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
        placeholder="Search by vehicle number, owner, mobile, RC or chassis number..."
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
