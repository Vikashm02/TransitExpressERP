"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileDown, Upload } from "lucide-react";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import CustomerDialog from "./CustomerDialog";
import CustomerBulkUploadDialog from "./CustomerBulkUploadDialog";
import CustomerTable from "./CustomerTable";
import { CUSTOMER_STATUS_OPTIONS, type Customer } from "./customer.schema";
import { downloadCustomerUploadTemplate } from "./customerBulkUpload";

import {
  createCustomer,
  deleteCustomer,
  getCustomers,
  updateCustomer,
  type CustomerRecord,
} from "@/components/services/customer.service";
import { useAuth } from "@/lib/auth/AuthProvider";

const PAGE_SIZE = 10;

export default function CustomerListPage() {
  const { isAdmin, hasPermission, hasAction } = useAuth();
  const canCreate = hasPermission("customers", "create_view");
  const canEdit = hasPermission("customers", "edit") || hasAction("customers", "edit");
  const canContinueDraft = canCreate || canEdit;
  const canDelete = isAdmin;

  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<CustomerRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);

  useEffect(() => {
    loadCustomers();
  }, []);

  async function loadCustomers() {
    try {
      setLoading(true);
      const data = await getCustomers();
      setCustomers(data);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load customers.");
    } finally {
      setLoading(false);
    }
  }

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase();

    return customers.filter((customer) => {
      const matchesSearch =
        !query ||
        [customer.name, customer.code, customer.city, customer.mobile, customer.gst]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(query));

      const matchesStatus = !statusFilter || customer.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [customers, search, statusFilter]);

  function handleAdd() {
    setEditingCustomer(null);
    setDialogOpen(true);
  }

  function handleEdit(customer: CustomerRecord) {
    if (customer.entryStatus === "draft") return;
    if (!canEdit) {
      toast.error("You do not have permission to edit finalized customers.");
      return;
    }
    setEditingCustomer(customer);
    setDialogOpen(true);
  }

  function handleContinueDraft(customer: CustomerRecord) {
    if (customer.entryStatus !== "draft") return;
    if (!canContinueDraft) {
      toast.error("You do not have permission to continue this draft.");
      return;
    }
    setEditingCustomer(customer);
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) setEditingCustomer(null);
  }

  async function handleSubmit(values: Customer) {
    try {
      setSaving(true);

      if (editingCustomer) {
        if (editingCustomer.entryStatus === "draft") {
          if (!canContinueDraft) {
            toast.error("You do not have permission to continue this draft.");
            return;
          }
        } else if (!canEdit) {
          toast.error("You do not have permission to edit finalized customers.");
          return;
        }
        await updateCustomer(editingCustomer.id, { ...values, entryStatus: "final" });
        toast.success("Customer updated successfully.");
      } else {
        await createCustomer({ ...values, entryStatus: "final" });
        toast.success("Customer created successfully.");
      }

      setDialogOpen(false);
      setEditingCustomer(null);
      await loadCustomers();
    } catch (error) {
      console.error(error);
      toast.error(
        editingCustomer
          ? "Unable to update customer."
          : "Unable to create customer."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleAutosave(values: Customer) {
    const draftValues = { ...values, entryStatus: "draft" as const };
    if (editingCustomer) {
      const updated = await updateCustomer(editingCustomer.id, draftValues);
      setEditingCustomer(updated);
      return;
    }
    const created = await createCustomer(draftValues);
    setEditingCustomer(created);
    await loadCustomers();
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;

    try {
      setDeleting(true);
      await deleteCustomer(deleteTarget.id);
      toast.success("Customer deleted successfully.");
      setDeleteTarget(null);
      await loadCustomers();
    } catch (error) {
      console.error(error);
      toast.error("Unable to delete customer.");
    } finally {
      setDeleting(false);
    }
  }

  function handleExport() {
    const headers = ["Code", "Name", "GST", "Mobile", "Email", "City", "Address", "Status"];
    const rows = filteredCustomers.map((customer) => [
      customer.code,
      customer.name,
      customer.gst,
      customer.mobile,
      customer.email,
      customer.city,
      customer.address,
      customer.status,
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
    link.download = "customers.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownloadTemplate() {
    try {
      await downloadCustomerUploadTemplate();
    } catch (error) {
      console.error(error);
      toast.error("Unable to generate the upload template.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        buttonText="Add Customer"
        onAdd={handleAdd}
        showAddButton={canCreate}
      />

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search by name, code, city, mobile or GST..."
        onRefresh={loadCustomers}
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
            options: CUSTOMER_STATUS_OPTIONS.map((status) => ({
              label: status,
              value: status,
            })),
            onChange: setStatusFilter,
          },
        ]}
      />

      <CustomerTable
        customers={filteredCustomers}
        loading={loading}
        pageSize={PAGE_SIZE}
        onEdit={handleEdit}
        onContinueDraft={handleContinueDraft}
        onDelete={setDeleteTarget}
        canEdit={canEdit}
        canContinueDraft={canContinueDraft}
        canDelete={canDelete}
      />

      <CustomerDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        customer={editingCustomer}
        loading={saving}
        onSubmit={handleSubmit}
        onAutosave={canContinueDraft ? handleAutosave : undefined}
      />

      <CustomerBulkUploadDialog
        open={bulkUploadOpen}
        onOpenChange={setBulkUploadOpen}
        existingCustomers={customers}
        onImported={loadCustomers}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete customer"
        description={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.name}"? This action cannot be undone.`
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
