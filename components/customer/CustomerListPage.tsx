"use client";

import { useEffect, useMemo, useState } from "react";
import { previewMasterPartyChange, applyMasterPartyChange, type MasterPartyChangePreview } from "@/components/services/masterPartyChange.service";
import MasterPartyChangeDialog from "@/components/common/MasterPartyChangeDialog";
import { createdOnColumn, exportCsv, type ExportColumn } from "@/lib/exportColumns";
import { matchesListSearch } from "@/lib/listSearch";
import { toast } from "sonner";
import { getUserFacingError } from "@/lib/errors/getUserFacingError";
import { FileDown, History, Upload } from "lucide-react";
import MasterPartyHistoryDialog from "@/components/common/MasterPartyHistoryDialog";

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

/** Export = Add/Edit form fields in form order (keep in sync with the form). */
const CUSTOMER_EXPORT_COLUMNS: ExportColumn<CustomerRecord>[] = [
  { header: "Customer Code", value: (r) => r.code },
  { header: "Customer Name", value: (r) => r.name },
  { header: "GST Number", value: (r) => r.gst },
  { header: "Mobile Number", value: (r) => r.mobile },
  { header: "Email", value: (r) => r.email },
  { header: "City", value: (r) => r.city },
  { header: "Status", value: (r) => r.status },
  { header: "Address", value: (r) => r.address },
  createdOnColumn((r) => r.created_at),
];

const PAGE_SIZE = 10;

export default function CustomerListPage() {
  const { isCreator, hasPermission, hasAction } = useAuth();
  const canCreate = hasPermission("customers", "create_view");
  const canEdit = hasPermission("customers", "edit") || hasAction("customers", "edit");
  const canContinueDraft = canCreate || canEdit;
  const canDelete = isCreator;

  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerRecord | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** Older-records decision after a master detail change (migration 119). */
  const [partyChange, setPartyChange] = useState<{ id: number; preview: MasterPartyChangePreview } | null>(null);
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
        matchesListSearch(query, [customer.name, customer.code, customer.city, customer.mobile, customer.gst, customer.status]);

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
        const wasFinal = editingCustomer.entryStatus !== "draft";
        const partyId = editingCustomer.id;
        await updateCustomer(partyId, { ...values, entryStatus: "final" });
        if (wasFinal) {
          // Name / GST / address change on a final record: ask about older records.
          const preview = await previewMasterPartyChange("customer", partyId);
          if (preview) {
            const used = preview.lrs + preview.deliveryChallans + preview.purchaseOrders + preview.bids + preview.conversations + preview.bills;
            if (used > 0) setPartyChange({ id: partyId, preview });
            else await applyMasterPartyChange("customer", partyId, "apply").catch(() => undefined);
          }
        }
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
      toast.error(getUserFacingError(error, editingCustomer ? "Unable to update customer." : "Unable to create customer."));
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
      toast.error(getUserFacingError(error, "Unable to delete customer."));
    } finally {
      setDeleting(false);
    }
  }

  function handleExport() {
    exportCsv("customers", CUSTOMER_EXPORT_COLUMNS, filteredCustomers);
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
        placeholder="Search name, code, GST, mobile, city, status..."
        onRefresh={loadCustomers}
        onExport={handleExport}
        actions={[
          ...(canEdit
            ? [{ key: "change-history", label: "Change history", icon: History, onClick: () => setHistoryOpen(true) }]
            : []),
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

      <MasterPartyHistoryDialog
        partyType="customer"
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onUndone={() => void loadCustomers()}
      />

      <MasterPartyChangeDialog
        partyId={partyChange?.id ?? null}
        preview={partyChange?.preview ?? null}
        onClose={() => setPartyChange(null)}
      />
    </div>
  );
}
