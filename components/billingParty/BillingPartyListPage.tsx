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

/** Export = Add/Edit form fields in form order (keep in sync with the form). */
const BILLING_PARTY_EXPORT_COLUMNS: ExportColumn<BillingPartyRecord>[] = [
  { header: "Billing Party Code", value: (r) => r.code },
  { header: "Billing Party Name", value: (r) => r.name },
  { header: "GST Number", value: (r) => r.gst },
  { header: "Mobile Number", value: (r) => r.mobile },
  { header: "Email", value: (r) => r.email },
  { header: "City", value: (r) => r.city },
  { header: "PO Number", value: (r) => r.poNumber },
  { header: "Concern Person", value: (r) => r.concernPerson },
  { header: "Vendor Code", value: (r) => r.vendorCode },
  { header: "Short Code", value: (r) => r.shortCode },
  { header: "Payment Cycle (Days)", value: (r) => r.paymentCycleDays },
  { header: "Status", value: (r) => r.status },
  { header: "Address", value: (r) => r.address },
  createdOnColumn((r) => r.created_at),
];

const PAGE_SIZE = 10;

export default function BillingPartyListPage() {
  const { isCreator, hasPermission, hasAction } = useAuth();
  const canCreate = hasPermission("billing_parties", "create_view");
  const canEdit =
    hasPermission("billing_parties", "edit") || hasAction("billing_parties", "edit");
  const canContinueDraft = canCreate || canEdit;
  const canDelete = isCreator;

  const [billingParties, setBillingParties] = useState<BillingPartyRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBillingParty, setEditingBillingParty] = useState<BillingPartyRecord | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** Older-records decision after a master detail change (migration 119). */
  const [partyChange, setPartyChange] = useState<{ id: number; preview: MasterPartyChangePreview } | null>(null);
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
        matchesListSearch(query, [billingParty.name, billingParty.code, billingParty.city, billingParty.mobile, billingParty.gst, billingParty.status]);

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
        const wasFinal = editingBillingParty.entryStatus !== "draft";
        const partyId = editingBillingParty.id;
        await updateBillingParty(partyId, { ...values, entryStatus: "final" });
        if (wasFinal) {
          // Name / GST / address change on a final record: ask about older records.
          const preview = await previewMasterPartyChange("billing_party", partyId);
          if (preview) {
            const used = preview.lrs + preview.deliveryChallans + preview.purchaseOrders + preview.bids + preview.conversations + preview.bills;
            if (used > 0) setPartyChange({ id: partyId, preview });
            else await applyMasterPartyChange("billing_party", partyId, "apply").catch(() => undefined);
          }
        }
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
      toast.error(getUserFacingError(error, editingBillingParty ? "Unable to update billing party." : "Unable to create billing party."));
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
      toast.error(getUserFacingError(error, "Unable to delete billing party."));
    } finally {
      setDeleting(false);
    }
  }

  function handleExport() {
    exportCsv("billing-parties", BILLING_PARTY_EXPORT_COLUMNS, filteredBillingParties);
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
        placeholder="Search name, code, GST, mobile, city, status..."
        onRefresh={loadBillingParties}
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

      <MasterPartyHistoryDialog
        partyType="billing_party"
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onUndone={() => void loadBillingParties()}
      />

      <MasterPartyChangeDialog
        partyId={partyChange?.id ?? null}
        preview={partyChange?.preview ?? null}
        onClose={() => setPartyChange(null)}
      />
    </div>
  );
}
