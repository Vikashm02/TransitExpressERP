"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ClipboardList,
  FileDown,
  FilePenLine,
  FileText,
  PackageCheck,
  Truck,
  Upload,
} from "lucide-react";

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
import PodDialog from "@/components/pod/PodDialog";
import type { Pod } from "@/components/pod/pod.schema";

import {
  createLR,
  createNumberedLrDraft,
  deleteLR,
  getLRs,
  getOwnDraftLRs,
  reassignLR,
  updateLR,
  type LRRecord,
} from "@/components/services/lr.service";
import {
  createPod,
  getPod,
  getPodLrIndex,
  updatePod,
  type PodRecord,
} from "@/components/services/pod.service";
import { syncVehicleMasterFromLr } from "@/components/services/vehicle.service";
import { allocateNextLrNumber } from "@/components/services/company.service";
import { getStaffUsers, type AppUserProfile } from "@/components/services/appUser.service";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  canContinueDraftEntry,
  isDraftEntry,
  isDraftLrNumber,
  needsLrNumberAllocation,
} from "@/lib/entryStatus";
import { normalizeLrForDraftPersist } from "@/lib/draftPersistence";
import LrSeriesStatus from "./LrSeriesStatus";
import PendingDraftLrsDialog from "./PendingDraftLrsDialog";
import ConsigneeIntelligenceDrawer, {
  type ConsigneeIntelligenceTarget,
} from "@/components/consigneeIntelligence/ConsigneeIntelligenceDrawer";
import MaterialIntelligenceDrawer, {
  type MaterialIntelligenceTarget,
} from "@/components/materialIntelligence/MaterialIntelligenceDrawer";

const PAGE_SIZE = 10;

/** Status filter sentinel — matches entry_status draft, not lr.status. */
const DRAFT_STATUS_FILTER = "__draft__";

type LrDialogMode = "create" | "view" | "edit";

export default function LRListPage() {
  const { isAdmin, isCreator, hasPermission, hasAction } = useAuth();
  const canCreate = hasPermission("lr", "create_view");
  const canEdit = hasPermission("lr", "edit") || hasAction("lr", "edit");
  const canContinueDraft = canContinueDraftEntry({ canCreate, canEdit });
  const canDelete = isCreator;
  const canPrint = hasAction("lr", "print");
  const canShare = hasAction("lr", "share");
  const canCreatePod = hasPermission("pod", "create_view");
  const canEditPod = hasPermission("pod", "edit");

  const [lrs, setLRs] = useState<LRRecord[]>([]);
  const [staff, setStaff] = useState<AppUserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [freightTypeFilter, setFreightTypeFilter] = useState("");
  const [createdByFilter, setCreatedByFilter] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<LrDialogMode>("create");
  const [editingLR, setEditingLR] = useState<LRRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<LRRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [shareTarget, setShareTarget] = useState<LRRecord | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const [consigneeIntelOpen, setConsigneeIntelOpen] = useState(false);
  const [consigneeIntelTarget, setConsigneeIntelTarget] =
    useState<ConsigneeIntelligenceTarget | null>(null);

  const [materialIntelOpen, setMaterialIntelOpen] = useState(false);
  const [materialIntelTarget, setMaterialIntelTarget] =
    useState<MaterialIntelligenceTarget | null>(null);

  const [reassignTarget, setReassignTarget] = useState<LRRecord | null>(null);
  const [reassignValue, setReassignValue] = useState("");
  const [reassigning, setReassigning] = useState(false);

  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [pendingDraftsOpen, setPendingDraftsOpen] = useState(false);
  const [pendingDrafts, setPendingDrafts] = useState<LRRecord[]>([]);
  const [pendingDraftSelectedId, setPendingDraftSelectedId] = useState<LRRecord["id"] | null>(
    null
  );
  const [checkingDrafts, setCheckingDrafts] = useState(false);

  /** Derived POD presence for the LR list (lr_number → pods.id). Read-only. */
  const [podIdByLrNumber, setPodIdByLrNumber] = useState<Map<string, number>>(
    () => new Map()
  );
  const [podDialogOpen, setPodDialogOpen] = useState(false);
  const [podDialogRecord, setPodDialogRecord] = useState<PodRecord | null>(null);
  const [podDialogInitialLr, setPodDialogInitialLr] = useState<string | null>(null);
  const [podDialogViewOnly, setPodDialogViewOnly] = useState(false);
  const [podSaving, setPodSaving] = useState(false);
  /** Prevents overlapping autosaves from overlapping create/update work. */
  const autosaveInFlightRef = useRef(false);
  /**
   * In-flight first create for this session. Concurrent autosaves await this
   * instead of calling create_numbered_lr_draft a second time.
   * DB RPC is still the source of truth for allocation atomicity.
   */
  const createDraftPromiseRef = useRef<Promise<LRRecord> | null>(null);
  /**
   * Create-session tracking. Never treat Continue-draft / Edit-final as a
   * new-create session.
   */
  const openedAsNewCreateRef = useRef(false);
  const sessionCreatedDraftIdRef = useRef<number | null>(null);
  const createSessionDiscardedRef = useRef(false);
  /** Bumped on each dialog open and on close so late autosaves are ignored. */
  const createSessionTokenRef = useRef(0);

  function beginNewCreateSession() {
    createSessionTokenRef.current += 1;
    openedAsNewCreateRef.current = true;
    sessionCreatedDraftIdRef.current = null;
    createDraftPromiseRef.current = null;
    createSessionDiscardedRef.current = false;
  }

  function beginExistingLrSession() {
    createSessionTokenRef.current += 1;
    openedAsNewCreateRef.current = false;
    sessionCreatedDraftIdRef.current = null;
    createDraftPromiseRef.current = null;
    createSessionDiscardedRef.current = false;
  }

  function clearCreateSessionTracking() {
    openedAsNewCreateRef.current = false;
    sessionCreatedDraftIdRef.current = null;
    createDraftPromiseRef.current = null;
    createSessionDiscardedRef.current = false;
  }

  useEffect(() => {
    loadLRs();
  }, []);

  useEffect(() => {
    getStaffUsers()
      .then(setStaff)
      .catch((error) => console.error(error));
  }, []);

  async function loadLRs() {
    try {
      setLoading(true);
      const [data, podIndex] = await Promise.all([getLRs(), getPodLrIndex()]);
      setLRs(data);
      const map = new Map<string, number>();
      for (const row of podIndex) {
        if (!map.has(row.lrNumber)) map.set(row.lrNumber, row.id);
      }
      setPodIdByLrNumber(map);
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

      const matchesStatus =
        !statusFilter ||
        (statusFilter === DRAFT_STATUS_FILTER
          ? isDraftEntry(lr.entryStatus)
          : lr.status === statusFilter);
      const matchesFreightType = !freightTypeFilter || lr.freightType === freightTypeFilter;
      const matchesCreatedBy = !createdByFilter || lr.createdBy === createdByFilter;

      return matchesSearch && matchesStatus && matchesFreightType && matchesCreatedBy;
    });
  }, [lrs, search, statusFilter, freightTypeFilter, createdByFilter]);

  const stats = useMemo(() => {
    const open = lrs.filter((lr) => lr.status === "Open" || lr.status === "In Transit").length;
    const delivered = lrs.filter((lr) => lr.status === "Delivered").length;
    const billed = lrs.filter((lr) => lr.status === "Billed").length;
    const totalDraft = lrs.filter((lr) => isDraftEntry(lr.entryStatus)).length;
    // Same source of truth as LRTable PodStatusChip: pending when lr_number is
    // absent from the getPodLrIndex() map (or blank → not in map).
    const totalPendingPod = lrs.filter((lr) => {
      const key = lr.lrNumber?.trim() ?? "";
      const hasPod = Boolean(key && podIdByLrNumber.has(key));
      return !hasPod;
    }).length;

    return { open, delivered, billed, totalDraft, totalPendingPod };
  }, [lrs, podIdByLrNumber]);

  function handleAdd() {
    void handleCreateLrClick();
  }

  function openNewLrCreateDialog() {
    beginNewCreateSession();
    setDialogMode("create");
    setEditingLR(null);
    setDialogOpen(true);
  }

  /**
   * Create LR entry point — if the signed-in user already has drafts,
   * nudge them before opening a brand-new create session. Does not
   * allocate an LR number.
   */
  async function handleCreateLrClick() {
    if (!canCreate || checkingDrafts) return;

    try {
      setCheckingDrafts(true);
      const drafts = await getOwnDraftLRs();
      if (drafts.length === 0) {
        openNewLrCreateDialog();
        return;
      }
      setPendingDrafts(drafts);
      setPendingDraftSelectedId(drafts[0]?.id ?? null);
      setPendingDraftsOpen(true);
    } catch (error) {
      console.error(error);
      toast.error("Unable to check for pending drafts. Opening Create LR.");
      openNewLrCreateDialog();
    } finally {
      setCheckingDrafts(false);
    }
  }

  function handlePendingDraftsOpenChange(open: boolean) {
    setPendingDraftsOpen(open);
    if (!open) {
      setPendingDrafts([]);
      setPendingDraftSelectedId(null);
    }
  }

  function handleOpenPendingDraft() {
    const draft = pendingDrafts.find((row) => row.id === pendingDraftSelectedId);
    if (!draft) return;
    handlePendingDraftsOpenChange(false);
    handleContinueDraft(draft);
  }

  function handleCreateNewDespiteDrafts() {
    handlePendingDraftsOpenChange(false);
    openNewLrCreateDialog();
  }

  function handleView(lr: LRRecord) {
    beginExistingLrSession();
    setDialogMode("view");
    setEditingLR(lr);
    setDialogOpen(true);
  }

  function handleEdit(lr: LRRecord) {
    if (isDraftEntry(lr.entryStatus)) return;
    if (!canEdit) {
      toast.error("You do not have permission to edit finalized LRs.");
      return;
    }
    beginExistingLrSession();
    setDialogMode("edit");
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
    setDialogMode("edit");
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

  function handlePodDialogOpenChange(open: boolean) {
    setPodDialogOpen(open);
    if (!open) {
      setPodDialogRecord(null);
      setPodDialogInitialLr(null);
      setPodDialogViewOnly(false);
    }
  }

  function handleCreatePod(lr: LRRecord) {
    if (!canCreatePod) {
      toast.error("You do not have permission to create a POD.");
      return;
    }
    if (isDraftEntry(lr.entryStatus) || isDraftLrNumber(lr.lrNumber) || !lr.lrNumber.trim()) {
      toast.error("POD can only be created for a finalized LR with a real LR number.");
      return;
    }
    if (podIdByLrNumber.has(lr.lrNumber.trim())) {
      toast.error(`A POD already exists for ${lr.lrNumber}.`);
      return;
    }
    setPodDialogRecord(null);
    setPodDialogInitialLr(lr.lrNumber.trim());
    setPodDialogViewOnly(false);
    setPodDialogOpen(true);
  }

  async function openExistingPod(lr: LRRecord, viewOnly: boolean) {
    const podId = podIdByLrNumber.get(lr.lrNumber.trim());
    if (podId == null) {
      toast.error(`No POD found for ${lr.lrNumber}.`);
      return;
    }
    try {
      const pod = await getPod(podId);
      setPodDialogRecord(pod);
      setPodDialogInitialLr(null);
      setPodDialogViewOnly(viewOnly);
      setPodDialogOpen(true);
    } catch (error) {
      console.error(error);
      toast.error("Unable to open POD.");
    }
  }

  function handleViewPod(lr: LRRecord) {
    void openExistingPod(lr, true);
  }

  function handleEditPod(lr: LRRecord) {
    if (!canEditPod) {
      toast.error("You do not have permission to edit a POD.");
      return;
    }
    void openExistingPod(lr, false);
  }

  /** Same as POD module: mark linked LR Delivered after POD save (status only). */
  async function markLRDeliveredFromPod(lrNumber: string) {
    const lr = lrs.find((record) => record.lrNumber === lrNumber);
    if (!lr || lr.status === "Delivered") return;
    await updateLR(lr.id, { ...lr, status: "Delivered" });
  }

  async function handlePodSubmit(values: Pod) {
    try {
      setPodSaving(true);

      if (podDialogRecord) {
        await updatePod(podDialogRecord.id, values);
        toast.success("POD updated successfully.");
      } else {
        await createPod(values);
        toast.success("POD created successfully.");
      }

      await markLRDeliveredFromPod(values.lrNumber);
      handlePodDialogOpenChange(false);
      await loadLRs();
    } catch (error) {
      console.error(error);
      const detail =
        error instanceof Error && error.message
          ? error.message
          : podDialogRecord
            ? "Unable to update POD."
            : "Unable to create POD.";
      toast.error(detail);
    } finally {
      setPodSaving(false);
    }
  }

  async function handleDialogOpenChange(open: boolean) {
    if (open) {
      setDialogOpen(true);
      return;
    }

    // Closing must NOT delete a numbered draft. Once Consignor/Consignee
    // reserved a real LR number, that draft + number remain until explicit
    // finalize or controlled draft management.
    createSessionDiscardedRef.current = true;
    createSessionTokenRef.current += 1;

    setDialogOpen(false);
    setEditingLR(null);
    setDialogMode("create");
    clearCreateSessionTracking();

    // Refresh so any kept numbered draft appears in the list.
    void loadLRs();
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

          // Numbered drafts already hold a reserved lr_number — keep it.
          // Allocate only for legacy empty / DRAFT-* rows.
          let lrNumber = editingLR.lrNumber;
          if (needsLrNumberAllocation(lrNumber)) {
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
        // Direct Save before React has editingLR, but a numbered draft may
        // already exist for this create session — finalize that row; never
        // allocate a second number.
        if (createDraftPromiseRef.current) {
          const draft = await createDraftPromiseRef.current;
          const finalized = await updateLR(draft.id, {
            ...values,
            lrNumber: draft.lrNumber,
            entryStatus: "final",
          });
          successMessage = `LR ${finalized.lrNumber} saved successfully.`;
        } else if (sessionCreatedDraftIdRef.current != null) {
          const draftId = sessionCreatedDraftIdRef.current;
          const knownNumber = !needsLrNumberAllocation(values.lrNumber)
            ? values.lrNumber.trim()
            : "";
          const finalized = await updateLR(draftId, {
            ...values,
            // Empty lrNumber is omitted by toRow — reserved DB number is kept.
            lrNumber: knownNumber,
            entryStatus: "final",
          });
          successMessage = `LR ${finalized.lrNumber} saved successfully.`;
        } else {
          const lrNumber = await allocateNextLrNumber();
          await createLR({ ...values, lrNumber, entryStatus: "final" });
          successMessage = `LR ${lrNumber} created successfully.`;
        }
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
      setDialogMode("create");
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
    // Hybrid numbering:
    // - Empty new form → no DB row, no allocate
    // - Consignor OR Consignee → create_numbered_lr_draft once (allocates)
    // - Later autosaves → update same draft; never allocate again
    if (createSessionDiscardedRef.current) return;

    const tokenAtStart = createSessionTokenRef.current;
    const isNewCreateSession = openedAsNewCreateRef.current;
    const hasMeaningfulParty =
      values.consignor.trim().length > 0 || values.consignee.trim().length > 0;

    // Resolve target draft id without relying only on React state (race-safe).
    let draftId = editingLR?.id ?? sessionCreatedDraftIdRef.current;

    if (draftId == null && createDraftPromiseRef.current) {
      try {
        const pending = await createDraftPromiseRef.current;
        draftId = pending.id;
      } catch {
        // First create failed; allow a retry below if still meaningful.
      }
    }

    if (draftId == null && !hasMeaningfulParty) return;
    if (createSessionDiscardedRef.current) return;
    if (tokenAtStart !== createSessionTokenRef.current) return;

    if (autosaveInFlightRef.current) return;
    autosaveInFlightRef.current = true;

    try {
      if (createSessionDiscardedRef.current) return;
      if (tokenAtStart !== createSessionTokenRef.current) return;

      const draftValues = normalizeLrForDraftPersist(values);

      if (draftId != null) {
        const keepNumber =
          editingLR?.id === draftId &&
          editingLR.lrNumber &&
          !isDraftLrNumber(editingLR.lrNumber)
            ? editingLR.lrNumber
            : draftValues.lrNumber && !isDraftLrNumber(draftValues.lrNumber)
              ? draftValues.lrNumber
              : editingLR?.lrNumber && !isDraftLrNumber(editingLR.lrNumber)
                ? editingLR.lrNumber
                : "";

        const updated = await updateLR(draftId, {
          ...draftValues,
          // Never blank out a reserved number on update.
          ...(keepNumber ? { lrNumber: keepNumber } : {}),
        });

        if (createSessionDiscardedRef.current) return;
        if (tokenAtStart !== createSessionTokenRef.current) return;

        setEditingLR(updated);
        return;
      }

      // First persist: allocate + insert in one DB transaction (once).
      if (!hasMeaningfulParty) return;

      const createPromise = createNumberedLrDraft(draftValues);
      createDraftPromiseRef.current = createPromise;

      let created: LRRecord;
      try {
        created = await createPromise;
      } finally {
        if (createDraftPromiseRef.current === createPromise) {
          createDraftPromiseRef.current = null;
        }
      }

      sessionCreatedDraftIdRef.current = created.id;

      // Dialog closed while create was in flight — KEEP the numbered draft.
      if (
        createSessionDiscardedRef.current ||
        tokenAtStart !== createSessionTokenRef.current
      ) {
        void loadLRs();
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
        disabled={checkingDrafts}
      />

      <LrSeriesStatus lrNumbers={lrs.map((lr) => lr.lrNumber)} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
          icon={FilePenLine}
          title="Total Draft"
          value={stats.totalDraft}
        />
        <StatCard
          icon={ClipboardList}
          title="Total Pending POD"
          value={stats.totalPendingPod}
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
            options: [
              { label: "Draft", value: DRAFT_STATUS_FILTER },
              ...LR_STATUS_OPTIONS.map((status) => ({
                label: status,
                value: status,
              })),
            ],
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
          {
            key: "createdBy",
            label: "Created By",
            value: createdByFilter,
            placeholder: "All creators",
            options: staff.map((user) => ({
              label: user.displayName,
              value: user.id,
            })),
            onChange: setCreatedByFilter,
          },
        ]}
      />

      <LRTable
        lrs={filteredLRs}
        loading={loading}
        pageSize={PAGE_SIZE}
        onView={handleView}
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
        podIdByLrNumber={podIdByLrNumber}
        canCreatePod={canCreatePod}
        canEditPod={canEditPod}
        onCreatePod={handleCreatePod}
        onViewPod={handleViewPod}
        onEditPod={handleEditPod}
        onConsigneeClick={(lr) => {
          const name = (lr.consignee || "").trim();
          if (!name) return;
          setConsigneeIntelTarget({
            consigneeName: name,
            consigneeGst: lr.consigneeGST || null,
          });
          setConsigneeIntelOpen(true);
        }}
        onMaterialClick={(lr) => {
          const name = (lr.material || "").trim();
          if (!name) return;
          setMaterialIntelTarget({ materialName: name });
          setMaterialIntelOpen(true);
        }}
      />

      <ConsigneeIntelligenceDrawer
        open={consigneeIntelOpen}
        onOpenChange={(open) => {
          setConsigneeIntelOpen(open);
          if (!open) setConsigneeIntelTarget(null);
        }}
        target={consigneeIntelTarget}
      />

      <MaterialIntelligenceDrawer
        open={materialIntelOpen}
        onOpenChange={(open) => {
          setMaterialIntelOpen(open);
          if (!open) setMaterialIntelTarget(null);
        }}
        target={materialIntelTarget}
        onOpenConsignee={(consigneeName) => {
          const name = consigneeName.trim();
          if (!name) return;
          setMaterialIntelOpen(false);
          setMaterialIntelTarget(null);
          setConsigneeIntelTarget({
            consigneeName: name,
            consigneeGst: null,
          });
          setConsigneeIntelOpen(true);
        }}
      />
      <LRDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        lr={editingLR}
        loading={saving}
        readOnly={dialogMode === "view"}
        onRequestEdit={
          dialogMode === "view" &&
          editingLR &&
          !isDraftEntry(editingLR.entryStatus) &&
          canEdit
            ? () => setDialogMode("edit")
            : undefined
        }
        onRequestContinueDraft={
          dialogMode === "view" &&
          editingLR &&
          isDraftEntry(editingLR.entryStatus) &&
          canContinueDraft
            ? () => handleContinueDraft(editingLR)
            : undefined
        }
        onSubmit={handleSubmit}
        onAutosave={
          dialogMode !== "view" && canContinueDraft ? handleAutosave : undefined
        }
      />

      <PodDialog
        open={podDialogOpen}
        onOpenChange={handlePodDialogOpenChange}
        pod={podDialogRecord}
        initialLrNumber={podDialogInitialLr}
        loading={podSaving}
        readOnly={podDialogViewOnly}
        onSubmit={handlePodSubmit}
      />

      <PendingDraftLrsDialog
        open={pendingDraftsOpen}
        onOpenChange={handlePendingDraftsOpenChange}
        drafts={pendingDrafts}
        selectedId={pendingDraftSelectedId}
        onSelect={setPendingDraftSelectedId}
        onOpenDraft={handleOpenPendingDraft}
        onCreateNew={handleCreateNewDespiteDrafts}
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
