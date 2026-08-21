"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Banknote, FileDown, FileText, PackageCheck, Truck, Upload } from "lucide-react";

import PageHeader from "@/components/ui/PageHeader";
import LearningPageChrome from "@/components/help/LearningPageChrome";
import { lrPageHelp } from "@/lib/help";
import SearchToolbar from "@/components/common/SearchToolbar";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FormDialog from "@/components/ui/FormDialog";
import FormSelect from "@/components/ui/FormSelect";
import { Button } from "@/components/ui/button";
import StatCard from "@/components/ui/StatCard";
import LRDialog from "./LRDialog";
import LRBulkUploadDialog from "./LRBulkUploadDialog";
import LRTable from "./LRTable";
import ShareLRDialog from "./ShareLRDialog";
import { FREIGHT_TYPE_OPTIONS, LR_STATUS_OPTIONS, type LR } from "./lr.schema";
import { downloadLRUploadTemplate } from "./lrBulkUpload";

import {
  createLR,
  deleteLR,
  getLRs,
  reassignLR,
  updateLR,
  type LRRecord,
} from "@/components/services/lr.service";
import { syncVehicleMasterFromLr } from "@/components/services/vehicle.service";
import { allocateNextLrNumber } from "@/components/services/company.service";
import { getStaffUsers, type AppUserProfile } from "@/components/services/appUser.service";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  canContinueDraftEntry,
  isDraftEntry,
  isDraftLrNumber,
} from "@/lib/entryStatus";
import { normalizeLrForDraftPersist } from "@/lib/draftPersistence";

const PAGE_SIZE = 10;

export default function LRListPage() {
  const { isAdmin, hasPermission, hasAction } = useAuth();
  const canCreate = hasPermission("lr", "create_view");
  const canEdit = hasPermission("lr", "edit") || hasAction("lr", "edit");
  const canContinueDraft = canContinueDraftEntry({ canCreate, canEdit });
  const canDelete = hasAction("lr", "delete");
  const canPrint = hasAction("lr", "print");
  const canShare = hasAction("lr", "share");

  const [lrs, setLRs] = useState<LRRecord[]>([]);
  const [staff, setStaff] = useState<AppUserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [freightTypeFilter, setFreightTypeFilter] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLR, setEditingLR] = useState<LRRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<LRRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [shareTarget, setShareTarget] = useState<LRRecord | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const [reassignTarget, setReassignTarget] = useState<LRRecord | null>(null);
  const [reassignValue, setReassignValue] = useState("");
  const [reassigning, setReassigning] = useState(false);

  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  /** Prevents overlapping autosaves from reserving two numbers for one draft. */
  const autosaveInFlightRef = useRef(false);
  /**
   * Create-session discard tracking (Cancel on brand-new LR only).
   * Never treat Continue-draft / Edit-final as a new-create session.
   */
  const openedAsNewCreateRef = useRef(false);
  const sessionCreatedDraftIdRef = useRef<number | null>(null);
  const createSessionDiscardedRef = useRef(false);
  /** Bumped on each dialog open and on discard so late autosaves are ignored. */
  const createSessionTokenRef = useRef(0);

  function beginNewCreateSession() {
    createSessionTokenRef.current += 1;
    openedAsNewCreateRef.current = true;
    sessionCreatedDraftIdRef.current = null;
    createSessionDiscardedRef.current = false;
  }

  function beginExistingLrSession() {
    createSessionTokenRef.current += 1;
    openedAsNewCreateRef.current = false;
    sessionCreatedDraftIdRef.current = null;
    createSessionDiscardedRef.current = false;
  }

  function clearCreateSessionTracking() {
    openedAsNewCreateRef.current = false;
    sessionCreatedDraftIdRef.current = null;
    createSessionDiscardedRef.current = false;
  }

  useEffect(() => {
    loadLRs();
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    getStaffUsers()
      .then(setStaff)
      .catch((error) => console.error(error));
  }, [isAdmin]);

  async function loadLRs() {
    try {
      setLoading(true);
      const data = await getLRs();
      setLRs(data);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load LRs.");
    } finally {
      setLoading(false);
    }
  }

  function resolveAssignedName(assignedTo: string | null): string {
    if (!assignedTo) return "Unassigned";
    return staff.find((user) => user.id === assignedTo)?.displayName ?? "Unknown";
  }

  function handleReassign(lr: LRRecord) {
    setReassignTarget(lr);
    setReassignValue(lr.assignedTo ?? "");
  }

  async function handleConfirmReassign() {
    if (!reassignTarget || !reassignValue) return;

    try {
      setReassigning(true);
      await reassignLR(reassignTarget.id, reassignValue);
      toast.success(`LR ${reassignTarget.lrNumber} reassigned successfully.`);
      setReassignTarget(null);
      await loadLRs();
    } catch (error) {
      console.error(error);
      toast.error("Unable to reassign LR.");
    } finally {
      setReassigning(false);
    }
  }

  const filteredLRs = useMemo(() => {
    const query = search.trim().toLowerCase();

    return lrs.filter((lr) => {
      const matchesSearch =
        !query ||
        [lr.lrNumber, lr.consignor, lr.consignee, lr.vehicleNumber]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(query));

      const matchesStatus = !statusFilter || lr.status === statusFilter;
      const matchesFreightType = !freightTypeFilter || lr.freightType === freightTypeFilter;

      return matchesSearch && matchesStatus && matchesFreightType;
    });
  }, [lrs, search, statusFilter, freightTypeFilter]);

  const stats = useMemo(() => {
    const open = lrs.filter((lr) => lr.status === "Open" || lr.status === "In Transit").length;
    const delivered = lrs.filter((lr) => lr.status === "Delivered").length;
    const billed = lrs.filter((lr) => lr.status === "Billed").length;
    const totalBillAmount = lrs.reduce((sum, lr) => sum + lr.billAmount, 0);

    return { open, delivered, billed, totalBillAmount };
  }, [lrs]);

  function handleAdd() {
    beginNewCreateSession();
    setEditingLR(null);
    setDialogOpen(true);
  }

  function handleEdit(lr: LRRecord) {
    if (isDraftEntry(lr.entryStatus)) return;
    if (!canEdit) {
      toast.error("You do not have permission to edit finalized LRs.");
      return;
    }
    beginExistingLrSession();
    setEditingLR(lr);
    setDialogOpen(true);
  }

  function handleContinueDraft(lr: LRRecord) {
    if (!isDraftEntry(lr.entryStatus)) return;
    if (!canContinueDraft) {
      toast.error("You do not have permission to continue this draft.");
      return;
    }
    beginExistingLrSession();
    setEditingLR(lr);
    setDialogOpen(true);
  }

  function handlePrint(lr: LRRecord) {
    window.open(`/lr/${lr.id}/print`, "_blank", "noopener,noreferrer");
  }

  function handleShare(lr: LRRecord) {
    setShareTarget(lr);
    setShareOpen(true);
  }

  async function handleDialogOpenChange(open: boolean) {
    if (open) {
      setDialogOpen(true);
      return;
    }

    // Mark discarded before closing so in-flight/debounced autosave bails out.
    const wasNewCreate = openedAsNewCreateRef.current;
    const draftIdToDelete = sessionCreatedDraftIdRef.current;
    createSessionDiscardedRef.current = true;
    createSessionTokenRef.current += 1;

    setDialogOpen(false);
    setEditingLR(null);

    if (wasNewCreate && draftIdToDelete != null) {
      try {
        await deleteLR(draftIdToDelete);
        await loadLRs();
      } catch (error) {
        console.error(error);
        toast.error("Unable to discard the unsaved draft.");
      }
    }

    clearCreateSessionTracking();
  }

  async function handleSubmit(values: LR) {
    try {
      setSaving(true);

      let successMessage = "LR saved successfully.";

      if (editingLR) {
        if (editingLR.entryStatus === "draft" || isDraftLrNumber(editingLR.lrNumber)) {
          if (!canContinueDraft) {
            toast.error("You do not have permission to continue this draft.");
            return;
          }

          // Number was reserved when the draft was first persisted.
          // Legacy DRAFT-* rows (pre-036) get one atomic allocation on finalize.
          let lrNumber = editingLR.lrNumber;
          if (isDraftLrNumber(lrNumber) || !lrNumber.trim()) {
            lrNumber = await allocateNextLrNumber();
          }

          await updateLR(editingLR.id, {
            ...values,
            lrNumber,
            entryStatus: "final",
          });
          successMessage = `LR ${lrNumber} saved successfully.`;
        } else {
          if (!canEdit) {
            toast.error("You do not have permission to edit finalized LRs.");
            return;
          }
          await updateLR(editingLR.id, {
            ...values,
            lrNumber: editingLR.lrNumber,
            entryStatus: "final",
          });
          successMessage = "LR updated successfully.";
        }
      } else {
        // Direct final create (no prior draft) — reserve atomically once.
        const lrNumber = await allocateNextLrNumber();
        await createLR({ ...values, lrNumber, entryStatus: "final" });
        successMessage = `LR ${lrNumber} created successfully.`;
      }

      // Vehicle Master sync only after LR save succeeds (not on draft autosave).
      try {
        await syncVehicleMasterFromLr({
          vehicleNumber: values.vehicleNumber,
          vehicleType: values.vehicleType,
          transporter: values.transporter,
          driverName: values.driverName,
          driverMobile: values.driverMobile,
        });
        toast.success(successMessage);
      } catch (syncError) {
        console.error(syncError);
        toast.error(
          "LR save हो गया, लेकिन Vehicle Master update नहीं हुआ। Vehicle Master में manually check करें।"
        );
      }

      setDialogOpen(false);
      setEditingLR(null);
      clearCreateSessionTracking();
      await loadLRs();
    } catch (error) {
      console.error(error);
      toast.error(
        editingLR
          ? "Unable to update LR."
          : "Unable to create LR."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleAutosave(values: LR) {
    // First persist reserves a real LR number atomically. Later autosaves
    // keep that number. Opening the form alone does not consume a number.
    if (createSessionDiscardedRef.current) return;
    if (autosaveInFlightRef.current) return;
    autosaveInFlightRef.current = true;

    const tokenAtStart = createSessionTokenRef.current;
    const isNewCreateSession = openedAsNewCreateRef.current;

    try {
      if (createSessionDiscardedRef.current) return;
      if (tokenAtStart !== createSessionTokenRef.current) return;

      const draftValues = normalizeLrForDraftPersist(values);

      if (editingLR) {
        if (createSessionDiscardedRef.current) return;
        if (tokenAtStart !== createSessionTokenRef.current) return;

        const reservedNumber =
          editingLR.lrNumber && !isDraftLrNumber(editingLR.lrNumber)
            ? editingLR.lrNumber
            : draftValues.lrNumber && !isDraftLrNumber(draftValues.lrNumber)
              ? draftValues.lrNumber
              : await allocateNextLrNumber();

        if (createSessionDiscardedRef.current) return;
        if (tokenAtStart !== createSessionTokenRef.current) return;

        const updated = await updateLR(editingLR.id, {
          ...draftValues,
          lrNumber: reservedNumber,
        });

        if (createSessionDiscardedRef.current) return;
        if (tokenAtStart !== createSessionTokenRef.current) return;

        setEditingLR(updated);
        return;
      }

      if (!values.consignor.trim() && !values.customer.trim()) return;
      if (createSessionDiscardedRef.current) return;
      if (tokenAtStart !== createSessionTokenRef.current) return;

      const lrNumber = await allocateNextLrNumber();
      if (createSessionDiscardedRef.current) return;
      if (tokenAtStart !== createSessionTokenRef.current) return;

      const created = await createLR({
        ...draftValues,
        lrNumber,
      });

      // Cancel won the race: remove only this exact create, do not reattach.
      if (
        createSessionDiscardedRef.current ||
        tokenAtStart !== createSessionTokenRef.current
      ) {
        if (isNewCreateSession) {
          try {
            await deleteLR(created.id);
            await loadLRs();
          } catch (error) {
            console.error(error);
            toast.error("Unable to discard the unsaved draft.");
          }
        }
        return;
      }

      if (isNewCreateSession) {
        sessionCreatedDraftIdRef.current = created.id;
      }
      setEditingLR(created);
      await loadLRs();
    } finally {
      autosaveInFlightRef.current = false;
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;

    try {
      setDeleting(true);
      await deleteLR(deleteTarget.id);
      toast.success("LR deleted successfully.");
      setDeleteTarget(null);
      await loadLRs();
    } catch (error) {
      console.error(error);
      toast.error("Unable to delete LR.");
    } finally {
      setDeleting(false);
    }
  }

  function handleExport() {
    const headers = [
      "LR Number",
      "LR Date",
      "Booking Branch",
      "Billing Party",
      "GST Payable By",
      "Consignor",
      "Consignor GST",
      "Consignee",
      "Consignee GST",
      "Vehicle Number",
      "Vehicle Type",
      "Transporter",
      "Driver Name",
      "Driver Mobile",
      "From",
      "To",
      "Material",
      "Package Type",
      "Packages",
      "Loading Weight",
      "Unloading Weight",
      "Charged Weight",
      "Bill Rate",
      "Bill Rate Type",
      "Bill Amount",
      "Lorry Hire Rate",
      "Lorry Hire Type",
      "Lorry Hire Amount",
      "Freight Type",
      "Profit Amount",
      "Status",
    ];

    const rows = filteredLRs.map((lr) => [
      lr.lrNumber,
      lr.lrDate,
      lr.bookingBranch,
      lr.customer,
      lr.billingParty,
      lr.consignor,
      lr.consignorGST,
      lr.consignee,
      lr.consigneeGST,
      lr.vehicleNumber,
      lr.vehicleType,
      lr.transporter,
      lr.driverName,
      lr.driverMobile,
      lr.from,
      lr.to,
      lr.material,
      lr.packageType,
      lr.packages,
      lr.loadingWeight,
      lr.unloadingWeight,
      lr.chargedWeight,
      lr.billRate,
      lr.billRateType,
      lr.billAmount,
      lr.lorryHireRate,
      lr.lorryHireType,
      lr.lorryHireAmount,
      lr.freightType,
      lr.profitAmount,
      lr.status,
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
    link.download = "lrs.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownloadTemplate() {
    try {
      await downloadLRUploadTemplate();
    } catch (error) {
      console.error(error);
      toast.error("Unable to generate the upload template.");
    }
  }

  return (
    <div className="space-y-6">
      <LearningPageChrome content={lrPageHelp} className="-mb-2" />
      <PageHeader
        title="LR Entry"
        buttonText="Create LR"
        onAdd={handleAdd}
        showAddButton={canCreate}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={FileText}
          title="Total LRs"
          value={lrs.length}
        />
        <StatCard
          icon={Truck}
          title="Open / In Transit"
          value={stats.open}
        />
        <StatCard
          icon={PackageCheck}
          title="Delivered / Billed"
          value={stats.delivered + stats.billed}
        />
        <StatCard
          icon={Banknote}
          title="Total Bill Amount"
          value={`₹ ${stats.totalBillAmount.toFixed(2)}`}
        />
      </div>

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search by LR number, consignor, consignee or vehicle number..."
        onRefresh={loadLRs}
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
            options: LR_STATUS_OPTIONS.map((status) => ({
              label: status,
              value: status,
            })),
            onChange: setStatusFilter,
          },
          {
            key: "freightType",
            label: "Freight Type",
            value: freightTypeFilter,
            placeholder: "All freight types",
            options: FREIGHT_TYPE_OPTIONS.map((freightType) => ({
              label: freightType,
              value: freightType,
            })),
            onChange: setFreightTypeFilter,
          },
        ]}
      />

      <LRTable
        lrs={filteredLRs}
        loading={loading}
        pageSize={PAGE_SIZE}
        onEdit={handleEdit}
        onContinueDraft={handleContinueDraft}
        onDelete={setDeleteTarget}
        onPrint={handlePrint}
        onShare={handleShare}
        isAdmin={isAdmin}
        onReassign={handleReassign}
        resolveAssignedName={resolveAssignedName}
        canEdit={canEdit}
        canContinueDraft={canContinueDraft}
        canDelete={canDelete}
        canPrint={canPrint}
        canShare={canShare}
      />

      <LRDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        lr={editingLR}
        loading={saving}
        onSubmit={handleSubmit}
        onAutosave={canContinueDraft ? handleAutosave : undefined}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete LR"
        description={
          deleteTarget
            ? `Are you sure you want to delete LR "${deleteTarget.lrNumber}"? This action cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        variant="destructive"
        loading={deleting}
        onConfirm={handleConfirmDelete}
      />

      <ShareLRDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        lr={shareTarget}
      />

      <LRBulkUploadDialog
        open={bulkUploadOpen}
        onOpenChange={setBulkUploadOpen}
        onImported={loadLRs}
      />

      <FormDialog
        open={Boolean(reassignTarget)}
        onOpenChange={(open) => !open && setReassignTarget(null)}
        title="Reassign LR"
        description={reassignTarget ? `Choose who LR "${reassignTarget.lrNumber}" should be assigned to.` : undefined}
        loading={reassigning}
        loadingText="Reassigning..."
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setReassignTarget(null)}
              disabled={reassigning}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmReassign}
              disabled={reassigning || !reassignValue}
            >
              {reassigning ? "Saving..." : "Reassign"}
            </Button>
          </>
        }
      >
        <FormSelect
          label="Assigned To"
          id="lr-reassign-select"
          required
          value={reassignValue}
          onValueChange={setReassignValue}
          options={staff.map((user) => ({ label: `${user.displayName} (${user.role})`, value: user.id }))}
          placeholder="Select staff member"
        />
      </FormDialog>
    </div>
  );
}
