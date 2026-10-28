"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createdColumns, exportCsv, type ExportColumn } from "@/lib/exportColumns";
import { matchesListSearch } from "@/lib/listSearch";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { getUserFacingError } from "@/lib/errors/getUserFacingError";
import { FileDown, Upload } from "lucide-react";

import PageHeader from "@/components/ui/PageHeader";
import LearningPageChrome from "@/components/help/LearningPageChrome";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { podPageHelp } from "@/lib/help";
import SearchToolbar from "@/components/common/SearchToolbar";
import PodDialog from "./PodDialog";
import PodBulkUploadDialog from "./PodBulkUploadDialog";
import PodTable, { type PodListRow } from "./PodTable";
import type { Pod } from "./pod.schema";
import { computePodNotificationChanges } from "./podNotificationChanges";
import { downloadPodUploadTemplate } from "./podBulkUpload";

import {
  createPod,
  deletePod,
  getPods,
  updatePod,
  type PodRecord,
} from "@/components/services/pod.service";
import { getLRs, updateLR, type LRRecord } from "@/components/services/lr.service";
import { getStaffUsers, type AppUserProfile } from "@/components/services/appUser.service";
import { useAuth } from "@/lib/auth/AuthProvider";
import { STAFF_EDIT_WINDOW_EXPIRED_MESSAGE, canStaffEditRecord } from "@/lib/editWindow";



const PAGE_SIZE = 10;

export default function PodListPage() {
  const { hasPermission, isAdmin } = useAuth();
  const canCreate = hasPermission("pod", "create_view");
  const canEdit = hasPermission("pod", "edit");
  const canDelete = isAdmin;
  const router = useRouter();
  const searchParams = useSearchParams();

  const [pods, setPods] = useState<PodRecord[]>([]);
  const [lrs, setLrs] = useState<LRRecord[]>([]);
  const [staff, setStaff] = useState<AppUserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPod, setEditingPod] = useState<PodRecord | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [saving, setSaving] = useState(false);

  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<PodRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Deep-link handling for notification taps: /pod?view=<id>&focus=<focusKey>
  const deepLinkId = searchParams.get("view");
  const deepLinkFocus = searchParams.get("focus");
  const handledDeepLinkRef = useRef<string | null>(null);
  const pendingFocusKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    loadData();
  }, []);

  // Handle a notification navigation once, then release the marker once
  // router.replace consumes its query so the same record can open again later.
  useEffect(() => {
    if (loading) return;
    if (!deepLinkId) {
      handledDeepLinkRef.current = null;
      return;
    }

    const signature = `${deepLinkId}|${deepLinkFocus ?? ""}`;
    if (handledDeepLinkRef.current === signature) return;

    const target = pods.find((p) => String(p.id) === deepLinkId);
    if (!target) return;

    handledDeepLinkRef.current = signature;
    router.replace("/pod", { scroll: false });
    handleView(target, deepLinkFocus ?? undefined);
  }, [loading, pods, deepLinkId, deepLinkFocus, router]);

  async function loadData() {
    try {
      setLoading(true);
      const [podData, lrData, staffData] = await Promise.all([
        getPods(),
        getLRs(),
        getStaffUsers(),
      ]);
      setPods(podData);
      setLrs(lrData);
      setStaff(staffData);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load PODs.");
    } finally {
      setLoading(false);
    }
  }

  const staffNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of staff) {
      map.set(user.id, user.displayName);
    }
    return map;
  }, [staff]);

  /** Consignee is never stored on `pods` (see pod.schema.ts) — resolved
   * here, read-only, from the matching LR purely for display.
   * Created By is resolved once from app_users via getStaffUsers(). */
  const podRows: PodListRow[] = useMemo(
    () =>
      pods.map((pod) => ({
        ...pod,
        consignee: lrs.find((lr) => lr.lrNumber === pod.lrNumber)?.consignee ?? "",
        createdByName: pod.createdBy
          ? staffNameById.get(pod.createdBy) ?? "Unknown User"
          : "Unknown User",
      })),
    [pods, lrs, staffNameById]
  );

  const filteredPods = useMemo(() => {
    const query = search.trim().toLowerCase();

    return podRows.filter((pod) => {
      if (!query) return true;

      return matchesListSearch(query, [pod.lrNumber, pod.consignee, pod.podDate, pod.unloadingDate, pod.unloadingWeight, pod.createdByName]);
    });
  }, [podRows, search]);

  function handleAdd() {
    setEditingPod(null);
    setViewOnly(false);
    setDialogOpen(true);
  }

  function handleEdit(pod: PodRecord) {
    if (!canStaffEditRecord(isAdmin, canEdit, pod)) {
      toast.error(canEdit ? STAFF_EDIT_WINDOW_EXPIRED_MESSAGE : "You do not have permission to edit PODs.");
      return;
    }
    setEditingPod(pod);
    setViewOnly(false);
    setDialogOpen(true);
  }

  function handleView(pod: PodRecord, focusKey?: string) {
    setEditingPod(pod);
    setViewOnly(true);
    setDialogOpen(true);
    if (focusKey) {
      pendingFocusKeyRef.current = focusKey;
    }
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      setEditingPod(null);
      setViewOnly(false);
      pendingFocusKeyRef.current = undefined;
    }
  }

  /** After a POD is saved, the linked LR is marked Delivered — its only
   * field touched here. Reuses the existing `updateLR()` with the LR's
   * own full record (unchanged) plus `status`; no LR business logic,
   * calculations, or other fields are modified. */
  async function markLRDelivered(lrNumber: string) {
    const lr = lrs.find((record) => record.lrNumber === lrNumber);
    if (!lr || lr.status === "Delivered") return;

    // Best-effort: the POD save itself already succeeded. An old LR
    // (e.g. past the staff 48h edit window) must not fail the POD save.
    try {
      await updateLR(lr.id, { ...lr, status: "Delivered" });
    } catch (error) {
      console.warn("Linked LR could not be marked Delivered.", error);
    }
  }

  async function handleSubmit(values: Pod) {
    try {
      setSaving(true);

      if (editingPod) {
        if (!canStaffEditRecord(isAdmin, canEdit, editingPod)) {
          toast.error(STAFF_EDIT_WINDOW_EXPIRED_MESSAGE);
          return;
        }
        const changedFields = computePodNotificationChanges(editingPod, values);
        await updatePod(editingPod.id, values, changedFields);
        if (changedFields.length > 0) {
          toast.success("POD updated successfully.");
        } else {
          toast.success("POD saved (no changes detected).");
        }
      } else {
        await createPod(values);
        toast.success("POD created successfully.");
      }

      await markLRDelivered(values.lrNumber);

      setDialogOpen(false);
      setEditingPod(null);
      pendingFocusKeyRef.current = undefined;
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error(
        getUserFacingError(error, editingPod ? "Unable to update POD." : "Unable to create POD.")
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget || !canDelete) return;

    try {
      setDeleting(true);
      await deletePod(deleteTarget.id);
      toast.success(`POD for ${deleteTarget.lrNumber} deleted.`);
      setDeleteTarget(null);
      setPods((prev) => prev.filter((p) => p.id !== deleteTarget.id));
    } catch (error) {
      console.error(error);
      toast.error(getUserFacingError(error, "Unable to delete POD. Admin authorization is required."));
    } finally {
      setDeleting(false);
    }
  }

  function handleExport() {
    const lrByNumber = new Map(lrs.map((lr) => [lr.lrNumber, lr]));
    exportCsv("pods", [
      { header: "LR Number", value: (r) => r.lrNumber },
      { header: "Consignor", value: (r) => lrByNumber.get(r.lrNumber)?.consignor },
      { header: "Consignee", value: (r) => r.consignee },
      { header: "Vehicle Number", value: (r) => lrByNumber.get(r.lrNumber)?.vehicleNumber },
      { header: "Driver Name", value: (r) => lrByNumber.get(r.lrNumber)?.driverName },
      { header: "From", value: (r) => lrByNumber.get(r.lrNumber)?.from },
      { header: "To", value: (r) => lrByNumber.get(r.lrNumber)?.to },
      { header: "POD Date", value: (r) => r.podDate },
      { header: "Unloading Weight", value: (r) => r.unloadingWeight },
      { header: "Unloading Date", value: (r) => r.unloadingDate },
      { header: "Proof of POD (link)", value: (r) => r.proofUrl },
      ...createdColumns<PodListRow>((r) => (r.createdBy ? r.createdByName : ""), (r) => r.created_at),
    ] satisfies ExportColumn<PodListRow>[], filteredPods);
  }


  async function handleDownloadTemplate() {
    try {
      await downloadPodUploadTemplate();
    } catch (error) {
      console.error(error);
      toast.error("Unable to generate the upload template.");
    }
  }

  return (
    <div className="space-y-6">
      <LearningPageChrome content={podPageHelp} className="-mb-2" />
      <PageHeader
        title="POD Entry"
        buttonText="Add POD"
        onAdd={handleAdd}
        showAddButton={canCreate}
      />

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search LR no., consignee, POD date, weight, created by..."
        onRefresh={loadData}
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
      />

      <PodTable
        pods={filteredPods}
        loading={loading}
        pageSize={PAGE_SIZE}
        onView={handleView}
        onEdit={handleEdit}
        onDelete={(pod) => setDeleteTarget(pod)}
        canEdit={canEdit}
        canDelete={canDelete}
        isAdmin={isAdmin}
      />

      <PodDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        pod={editingPod}
        loading={saving}
        readOnly={viewOnly}
        onSubmit={handleSubmit}
        focusKey={pendingFocusKeyRef.current}
      />

      <PodBulkUploadDialog
        open={bulkUploadOpen}
        onOpenChange={setBulkUploadOpen}
        existingLRs={lrs}
        onImported={loadData}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
        title="Delete POD?"
        description={
          deleteTarget
            ? `This will permanently remove the POD for ${deleteTarget.lrNumber}. The LR itself is not deleted and will become eligible for Add POD again.`
            : undefined
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loading={deleting}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  );
}
