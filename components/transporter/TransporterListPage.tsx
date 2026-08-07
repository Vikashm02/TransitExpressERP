"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import TransporterDialog from "./TransporterDialog";
import TransporterTable from "./TransporterTable";
import { TRANSPORTER_STATUS_OPTIONS, type Transporter } from "./transporter.schema";

import {
  createTransporter,
  deleteTransporter,
  getTransporters,
  updateTransporter,
  type TransporterRecord,
} from "@/components/services/transporter.service";

const PAGE_SIZE = 10;

export default function TransporterListPage() {
  const [transporters, setTransporters] = useState<TransporterRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTransporter, setEditingTransporter] = useState<TransporterRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<TransporterRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadTransporters();
  }, []);

  async function loadTransporters() {
    try {
      setLoading(true);
      const data = await getTransporters();
      setTransporters(data);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load transporters.");
    } finally {
      setLoading(false);
    }
  }

  const filteredTransporters = useMemo(() => {
    const query = search.trim().toLowerCase();

    return transporters.filter((transporter) => {
      const matchesSearch =
        !query ||
        [transporter.transporterName, transporter.contactPerson, transporter.mobile, transporter.gstin]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(query));

      const matchesStatus = !statusFilter || transporter.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [transporters, search, statusFilter]);

  function handleAdd() {
    setEditingTransporter(null);
    setDialogOpen(true);
  }

  function handleEdit(transporter: TransporterRecord) {
    setEditingTransporter(transporter);
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) setEditingTransporter(null);
  }

  async function handleSubmit(values: Transporter) {
    try {
      setSaving(true);

      if (editingTransporter) {
        await updateTransporter(editingTransporter.id, values);
        toast.success("Transporter updated successfully.");
      } else {
        await createTransporter(values);
        toast.success("Transporter created successfully.");
      }

      setDialogOpen(false);
      setEditingTransporter(null);
      await loadTransporters();
    } catch (error) {
      console.error(error);
      toast.error(
        editingTransporter
          ? "Unable to update transporter."
          : "Unable to create transporter."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;

    try {
      setDeleting(true);
      await deleteTransporter(deleteTarget.id);
      toast.success("Transporter deleted successfully.");
      setDeleteTarget(null);
      await loadTransporters();
    } catch (error) {
      console.error(error);
      toast.error("Unable to delete transporter.");
    } finally {
      setDeleting(false);
    }
  }

  function handleExport() {
    const headers = [
      "Code",
      "Transporter Name",
      "Transporter Type",
      "GSTIN",
      "PAN",
      "Contact Person",
      "Mobile",
      "Alternate Mobile",
      "Email",
      "Website",
      "Address",
      "City",
      "State",
      "Pincode",
      "Account Holder Name",
      "Bank Name",
      "Account Number",
      "IFSC",
      "UPI ID",
      "Payment Term",
      "Credit Days",
      "Credit Limit",
      "Preferred Payment Mode",
      "Remarks",
      "Status",
    ];

    const rows = filteredTransporters.map((transporter) => [
      transporter.code,
      transporter.transporterName,
      transporter.transporterType,
      transporter.gstin,
      transporter.pan,
      transporter.contactPerson,
      transporter.mobile,
      transporter.alternateMobile,
      transporter.email,
      transporter.website,
      transporter.address,
      transporter.city,
      transporter.state,
      transporter.pincode,
      transporter.accountHolderName,
      transporter.bankName,
      transporter.accountNumber,
      transporter.ifsc,
      transporter.upiId,
      transporter.paymentTerm,
      transporter.creditDays,
      transporter.creditLimit,
      transporter.preferredPaymentMode,
      transporter.remarks,
      transporter.status,
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
    link.download = "transporters.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transporter Master"
        buttonText="Add Transporter"
        onAdd={handleAdd}
      />

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search by transporter name, contact person, mobile or GSTIN..."
        onRefresh={loadTransporters}
        onExport={handleExport}
        filters={[
          {
            key: "status",
            label: "Status",
            value: statusFilter,
            placeholder: "All statuses",
            options: TRANSPORTER_STATUS_OPTIONS.map((status) => ({
              label: status,
              value: status,
            })),
            onChange: setStatusFilter,
          },
        ]}
      />

      <TransporterTable
        transporters={filteredTransporters}
        loading={loading}
        pageSize={PAGE_SIZE}
        onEdit={handleEdit}
        onDelete={setDeleteTarget}
      />

      <TransporterDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        transporter={editingTransporter}
        loading={saving}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete transporter"
        description={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.transporterName}"? This action cannot be undone.`
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
