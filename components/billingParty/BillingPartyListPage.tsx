"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileDown, Upload } from "lucide-react";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import BillingPartyDialog from "./BillingPartyDialog";
import BillingPartyBulkUploadDialog from "./BillingPartyBulkUploadDialog";
import BillingPartyTable from "./BillingPartyTable";
import { BILLING_PARTY_STATUS_OPTIONS, type BillingPartyMaster } from "./billingParty.schema";
import { downloadBillingPartyUploadTemplate } from "./billingPartyBulkUpload";

import {
  createBillingParty,
  deleteBillingParty,
  getBillingParties,
  updateBillingParty,
  type BillingPartyRecord,
} from "@/components/services/billingParty.service";
import { useAuth } from "@/lib/auth/AuthProvider";

const PAGE_SIZE = 10;

export default function BillingPartyListPage() {
  const { hasPermission, hasAction } = useAuth();
  const canCreate = hasPermission("billing_parties", "create_view");
  const canEdit =
    hasPermission("billing_parties", "edit") || hasAction("billing_parties", "edit");
  const canContinueDraft = canCreate || canEdit;
  const canDelete = hasAction("billing_parties", "delete");

  const [billingParties, setBillingParties] = useState<BillingPartyRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBillingParty, setEditingBillingParty] = useState<BillingPartyRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<BillingPartyRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);

  useEffect(() => {
    loadBillingParties();
  }, []);

  async function loadBillingParties() {
    try {
      setLoading(true);
      const data = await getBillingParties();
      setBillingParties(data);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load billing parties.");
    } finally {
      setLoading(false);
    }
  }

  const filteredBillingParties = useMemo(() => {
    const query = search.trim().toLowerCase();

    return billingParties.filter((billingParty) => {
      const matchesSearch =
        !query ||
        [billingParty.name, billingParty.code, billingParty.city, billingParty.mobile, billingParty.gst]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(query));

      const matchesStatus = !statusFilter || billingParty.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [billingParties, search, statusFilter]);

  function handleAdd() {
    setEditingBillingParty(null);
    setDialogOpen(true);
  }

  function handleEdit(billingParty: BillingPartyRecord) {
    if (billingParty.entryStatus === "draft") return;
    if (!canEdit) {
      toast.error("You do not have permission to edit finalized billing parties.");
      return;
    }
    setEditingBillingParty(billingParty);
    setDialogOpen(true);
  }

  function handleContinueDraft(billingParty: BillingPartyRecord) {
    if (billingParty.entryStatus !== "draft") return;
    if (!canContinueDraft) {
      toast.error("You do not have permission to continue this draft.");
      return;
    }
    setEditingBillingParty(billingParty);
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) setEditingBillingParty(null);
  }

  async function handleSubmit(values: BillingPartyMaster) {
    try {
      setSaving(true);

      if (editingBillingParty) {
        if (editingBillingParty.entryStatus === "draft") {
          if (!canContinueDraft) {
            toast.error("You do not have permission to continue this draft.");
            return;
          }
        } else if (!canEdit) {
          toast.error("You do not have permission to edit finalized billing parties.");
          return;
        }
        await updateBillingParty(editingBillingParty.id, { ...values, entryStatus: "final" });
        toast.success("Billing party updated successfully.");
      } else {
        await createBillingParty({ ...values, entryStatus: "final" });
        toast.success("Billing party created successfully.");
      }

      setDialogOpen(false);
      setEditingBillingParty(null);
      await loadBillingParties();
    } catch (error) {
      console.error(error);
      toast.error(
        editingBillingParty
          ? "Unable to update billing party."
          : "Unable to create billing party."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleAutosave(values: BillingPartyMaster) {
    const draftValues = { ...values, entryStatus: "draft" as const };
    if (editingBillingParty) {
      const updated = await updateBillingParty(editingBillingParty.id, draftValues);
      setEditingBillingParty(updated);
      return;
    }
    const created = await createBillingParty(draftValues);
    setEditingBillingParty(created);
    await loadBillingParties();
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;

    try {
      setDeleting(true);
      await deleteBillingParty(deleteTarget.id);
      toast.success("Billing party deleted successfully.");
      setDeleteTarget(null);
      await loadBillingParties();
    } catch (error) {
      console.error(error);
      toast.error("Unable to delete billing party.");
    } finally {
      setDeleting(false);
    }
  }

  function handleExport() {
    const headers = ["Code", "Name", "GST", "Mobile", "Email", "City", "Address", "Status"];
    const rows = filteredBillingParties.map((billingParty) => [
      billingParty.code,
      billingParty.name,
      billingParty.gst,
      billingParty.mobile,
      billingParty.email,
      billingParty.city,
      billingParty.address,
      billingParty.status,
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
    link.download = "billing-parties.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownloadTemplate() {
    try {
      await downloadBillingPartyUploadTemplate();
    } catch (error) {
      console.error(error);
      toast.error("Unable to generate the upload template.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing Party Master"
        buttonText="Add Billing Party"
        onAdd={handleAdd}
        showAddButton={canCreate}
      />

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search by name, code, city, mobile or GST..."
        onRefresh={loadBillingParties}
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
            options: BILLING_PARTY_STATUS_OPTIONS.map((status) => ({
              label: status,
              value: status,
            })),
            onChange: setStatusFilter,
          },
        ]}
      />

      <BillingPartyTable
        billingParties={filteredBillingParties}
        loading={loading}
        pageSize={PAGE_SIZE}
        onEdit={handleEdit}
        onContinueDraft={handleContinueDraft}
        onDelete={setDeleteTarget}
        canEdit={canEdit}
        canContinueDraft={canContinueDraft}
        canDelete={canDelete}
      />

      <BillingPartyDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        billingParty={editingBillingParty}
        loading={saving}
        onSubmit={handleSubmit}
        onAutosave={canContinueDraft ? handleAutosave : undefined}
      />

      <BillingPartyBulkUploadDialog
        open={bulkUploadOpen}
        onOpenChange={setBulkUploadOpen}
        existingBillingParties={billingParties}
        onImported={loadBillingParties}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete billing party"
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
