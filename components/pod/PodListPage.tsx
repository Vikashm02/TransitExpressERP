"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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

const PAGE_SIZE = 10;

export default function PodListPage() {
  const { hasPermission, isAdmin } = useAuth();
  const canCreate = hasPermission("pod", "create_view");
  const canEdit = hasPermission("pod", "edit");
  const canDelete = isAdmin;

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

  useEffect(() => {
    loadData();
  }, []);

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

      return [pod.lrNumber, pod.consignee]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(query));
    });
  }, [podRows, search]);

  function handleAdd() {
    setEditingPod(null);
    setViewOnly(false);
    setDialogOpen(true);
  }

  function handleEdit(pod: PodRecord) {
    setEditingPod(pod);
    setViewOnly(false);
    setDialogOpen(true);
  }

  function handleView(pod: PodRecord) {
    setEditingPod(pod);
    setViewOnly(true);
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      setEditingPod(null);
      setViewOnly(false);
    }
  }

  /** After a POD is saved, the linked LR is marked Delivered — its only
   * field touched here. Reuses the existing `updateLR()` with the LR's
   * own full record (unchanged) plus `status`; no LR business logic,
   * calculations, or other fields are modified. */
  async function markLRDelivered(lrNumber: string) {
    const lr = lrs.find((record) => record.lrNumber === lrNumber);
    if (!lr || lr.status === "Delivered") return;

    await updateLR(lr.id, { ...lr, status: "Delivered" });
  }

  async function handleSubmit(values: Pod) {
    try {
      setSaving(true);

      if (editingPod) {
        await updatePod(editingPod.id, values);
        toast.success("POD updated successfully.");
      } else {
        await createPod(values);
        toast.success("POD created successfully.");
      }

      await markLRDelivered(values.lrNumber);

      setDialogOpen(false);
      setEditingPod(null);
      await loadData();
    } catch (error) {
      console.error(error);
      const detail =
        error instanceof Error && error.message
          ? error.message
          : editingPod
            ? "Unable to update POD."
            : "Unable to create POD.";
      toast.error(detail);
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
      toast.error("Unable to delete POD. Admin authorization is required.");
    } finally {
      setDeleting(false);
    }
  }

  function handleExport() {
    const headers = [
      "LR Number",
      "Consignee",
      "POD Date",
      "Unloading Weight",
      "Unloading Date",
      "POD Uploaded",
    ];

    const rows = filteredPods.map((pod) => [
      pod.lrNumber,
      pod.consignee,
      pod.podDate,
      pod.unloadingWeight,
      pod.unloadingDate,
      pod.proofUrl ? "Yes" : "No",
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
    link.download = "pods.csv";
    link.click();
    URL.revokeObjectURL(url);
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
        placeholder="Search by LR number or consignee..."
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
      />

      <PodDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        pod={editingPod}
        loading={saving}
        readOnly={viewOnly}
        onSubmit={handleSubmit}
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
