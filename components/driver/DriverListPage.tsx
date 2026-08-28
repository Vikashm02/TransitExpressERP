"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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

const PAGE_SIZE = 10;

export default function DriverListPage() {
  const { isAdmin } = useAuth();
  const canDelete = isAdmin;
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
        [driver.driverName, driver.mobile, driver.licenseNumber, driver.aadhaarNumber]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(query));

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
      toast.error(
        editingDriver
          ? "Unable to update driver."
          : "Unable to create driver."
      );
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
      toast.error("Unable to delete driver.");
    } finally {
      setDeleting(false);
    }
  }

  function handleExport() {
    const headers = [
      "Driver Name",
      "Driver Type",
      "Date of Birth",
      "Blood Group",
      "Experience (Years)",
      "Mobile",
      "Alternate Mobile",
      "Address",
      "Emergency Contact Name",
      "Emergency Contact Number",
      "License Number",
      "License Type",
      "License Issuing State",
      "License Expiry",
      "Aadhaar Number",
      "PAN",
      "Date of Joining",
      "Preferred Vehicle",
      "Bank Name",
      "Account Number",
      "IFSC",
      "Remarks",
      "Status",
    ];

    const rows = filteredDrivers.map((driver) => [
      driver.driverName,
      driver.driverType,
      driver.dateOfBirth,
      driver.bloodGroup,
      driver.experienceYears,
      driver.mobile,
      driver.alternateMobile,
      driver.address,
      driver.emergencyContactName,
      driver.emergencyContactNumber,
      driver.licenseNumber,
      driver.licenseType,
      driver.licenseIssuingState,
      driver.licenseExpiry,
      driver.aadhaarNumber,
      driver.pan,
      driver.dateOfJoining,
      driver.preferredVehicle,
      driver.bankName,
      driver.accountNumber,
      driver.ifsc,
      driver.remarks,
      driver.status,
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
    link.download = "drivers.csv";
    link.click();
    URL.revokeObjectURL(url);
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
        placeholder="Search by driver name, mobile, license or Aadhaar number..."
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
