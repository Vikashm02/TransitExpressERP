"use client";

import { useEffect, useMemo, useState } from "react";
import { createdOnColumn, exportCsv, type ExportColumn } from "@/lib/exportColumns";
import { matchesListSearch } from "@/lib/listSearch";
import { toast } from "sonner";
import { getUserFacingError } from "@/lib/errors/getUserFacingError";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import DriverDialog from "./DriverDialog";
import DriverTable from "./DriverTable";
import { DRIVER_STATUS_OPTIONS, type Driver } from "./driver.schema";

import {
  createDriver,
  deleteDriver,
  getDrivers,
  updateDriver,
  type DriverRecord,
} from "@/components/services/driver.service";
import { useAuth } from "@/lib/auth/AuthProvider";

/** Export = Add/Edit form fields in form order (keep in sync with the form). */
const DRIVER_EXPORT_COLUMNS: ExportColumn<DriverRecord>[] = [
  { header: "Driver Name", value: (r) => r.driverName },
  { header: "Driver Type", value: (r) => r.driverType },
  { header: "Date of Birth", value: (r) => r.dateOfBirth },
  { header: "Blood Group", value: (r) => r.bloodGroup },
  { header: "Experience (Years)", value: (r) => r.experienceYears },
  { header: "Mobile", value: (r) => r.mobile },
  { header: "Alternate Mobile", value: (r) => r.alternateMobile },
  { header: "Address", value: (r) => r.address },
  { header: "Emergency Contact Name", value: (r) => r.emergencyContactName },
  { header: "Emergency Contact Number", value: (r) => r.emergencyContactNumber },
  { header: "License Number", value: (r) => r.licenseNumber },
  { header: "License Type", value: (r) => r.licenseType },
  { header: "License Issuing State", value: (r) => r.licenseIssuingState },
  { header: "License Expiry", value: (r) => r.licenseExpiry },
  { header: "Aadhaar Number", value: (r) => r.aadhaarNumber },
  { header: "PAN", value: (r) => r.pan },
  { header: "Date of Joining", value: (r) => r.dateOfJoining },
  { header: "Preferred Vehicle", value: (r) => r.preferredVehicle },
  { header: "Bank Name", value: (r) => r.bankName },
  { header: "Account Number", value: (r) => r.accountNumber },
  { header: "IFSC", value: (r) => r.ifsc },
  { header: "Photo (link)", value: (r) => r.photoUrl },
  { header: "Status", value: (r) => r.status },
  { header: "Remarks", value: (r) => r.remarks },
  createdOnColumn((r) => r.created_at),
];

const PAGE_SIZE = 10;

export default function DriverListPage() {
  const { isCreator } = useAuth();
  const canDelete = isCreator;
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<DriverRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<DriverRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadDrivers();
  }, []);

  async function loadDrivers() {
    try {
      setLoading(true);
      const data = await getDrivers();
      setDrivers(data);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load drivers.");
    } finally {
      setLoading(false);
    }
  }

  const filteredDrivers = useMemo(() => {
    const query = search.trim().toLowerCase();

    return drivers.filter((driver) => {
      const matchesSearch =
        !query ||
        matchesListSearch(query, [driver.driverName, driver.mobile, driver.licenseNumber, driver.aadhaarNumber, driver.driverType, driver.status]);

      const matchesStatus = !statusFilter || driver.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [drivers, search, statusFilter]);

  function handleAdd() {
    setEditingDriver(null);
    setDialogOpen(true);
  }

  function handleEdit(driver: DriverRecord) {
    setEditingDriver(driver);
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) setEditingDriver(null);
  }

  async function handleSubmit(values: Driver) {
    try {
      setSaving(true);

      if (editingDriver) {
        await updateDriver(editingDriver.id, values);
        toast.success("Driver updated successfully.");
      } else {
        await createDriver(values);
        toast.success("Driver created successfully.");
      }

      setDialogOpen(false);
      setEditingDriver(null);
      await loadDrivers();
    } catch (error) {
      console.error(error);
      toast.error(getUserFacingError(error, editingDriver ? "Unable to update driver." : "Unable to create driver."));
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;

    try {
      setDeleting(true);
      await deleteDriver(deleteTarget.id);
      toast.success("Driver deleted successfully.");
      setDeleteTarget(null);
      await loadDrivers();
    } catch (error) {
      console.error(error);
      toast.error(getUserFacingError(error, "Unable to delete driver."));
    } finally {
      setDeleting(false);
    }
  }

  function handleExport() {
    exportCsv("drivers", DRIVER_EXPORT_COLUMNS, filteredDrivers);
  }


  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver Master"
        buttonText="Add Driver"
        onAdd={handleAdd}
      />

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search driver name, mobile, license, type, status..."
        onRefresh={loadDrivers}
        onExport={handleExport}
        filters={[
          {
            key: "status",
            label: "Status",
            value: statusFilter,
            placeholder: "All statuses",
            options: DRIVER_STATUS_OPTIONS.map((status) => ({
              label: status,
              value: status,
            })),
            onChange: setStatusFilter,
          },
        ]}
      />

      <DriverTable
        drivers={filteredDrivers}
        loading={loading}
        pageSize={PAGE_SIZE}
        onEdit={handleEdit}
        onDelete={setDeleteTarget}
        canDelete={canDelete}
      />

      <DriverDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        driver={editingDriver}
        loading={saving}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete driver"
        description={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.driverName}"? This action cannot be undone.`
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
