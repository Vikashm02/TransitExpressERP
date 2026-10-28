"use client";

import { useEffect, useMemo, useState } from "react";
import { createdOnColumn, exportCsv, type ExportColumn } from "@/lib/exportColumns";
import { matchesListSearch } from "@/lib/listSearch";
import { toast } from "sonner";
import { getUserFacingError } from "@/lib/errors/getUserFacingError";

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
import { useAuth } from "@/lib/auth/AuthProvider";

/** Export = Add/Edit form fields in form order (keep in sync with the form). */
const TRANSPORTER_EXPORT_COLUMNS: ExportColumn<TransporterRecord>[] = [
  { header: "Transporter Code", value: (r) => r.code },
  { header: "Transporter Name", value: (r) => r.transporterName },
  { header: "Transporter Type", value: (r) => r.transporterType },
  { header: "GSTIN", value: (r) => r.gstin },
  { header: "PAN", value: (r) => r.pan },
  { header: "Contact Person", value: (r) => r.contactPerson },
  { header: "Mobile", value: (r) => r.mobile },
  { header: "Alternate Mobile", value: (r) => r.alternateMobile },
  { header: "Email", value: (r) => r.email },
  { header: "Website", value: (r) => r.website },
  { header: "Address", value: (r) => r.address },
  { header: "City", value: (r) => r.city },
  { header: "State", value: (r) => r.state },
  { header: "Pincode", value: (r) => r.pincode },
  { header: "Account Holder Name", value: (r) => r.accountHolderName },
  { header: "Bank Name", value: (r) => r.bankName },
  { header: "Account Number", value: (r) => r.accountNumber },
  { header: "IFSC", value: (r) => r.ifsc },
  { header: "UPI ID", value: (r) => r.upiId },
  { header: "Payment Term", value: (r) => r.paymentTerm },
  { header: "Credit Days", value: (r) => r.creditDays },
  { header: "Credit Limit", value: (r) => r.creditLimit },
  { header: "Preferred Payment Mode", value: (r) => r.preferredPaymentMode },
  { header: "Status", value: (r) => r.status },
  { header: "Remarks", value: (r) => r.remarks },
  createdOnColumn((r) => r.created_at),
];

const PAGE_SIZE = 10;

export default function TransporterListPage() {
  const { isCreator } = useAuth();
  const canDelete = isCreator;
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
        matchesListSearch(query, [transporter.code, transporter.transporterName, transporter.transporterType, transporter.contactPerson, transporter.mobile, transporter.gstin, transporter.paymentTerm, transporter.status]);

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
      toast.error(getUserFacingError(error, editingTransporter ? "Unable to update transporter." : "Unable to create transporter."));
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
      toast.error(getUserFacingError(error, "Unable to delete transporter."));
    } finally {
      setDeleting(false);
    }
  }

  function handleExport() {
    exportCsv("transporters", TRANSPORTER_EXPORT_COLUMNS, filteredTransporters);
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
        placeholder="Search code, name, type, contact, mobile, GSTIN, status..."
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
        canDelete={canDelete}
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
