"use client";

import { useEffect, useMemo, useState } from "react";
import { createdOnColumn, exportCsv, type ExportColumn } from "@/lib/exportColumns";
import { matchesListSearch } from "@/lib/listSearch";
import { toast } from "sonner";
import { getUserFacingError } from "@/lib/errors/getUserFacingError";
import { FileDown, Upload } from "lucide-react";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import MaterialDialog from "./MaterialDialog";
import MaterialBulkUploadDialog from "./MaterialBulkUploadDialog";
import MaterialTable from "./MaterialTable";
import { MATERIAL_STATUS_OPTIONS, type Material } from "./material.schema";
import { downloadMaterialUploadTemplate } from "./materialBulkUpload";

import {
  createMaterial,
  deleteMaterial,
  getMaterials,
  updateMaterial,
  type MaterialRecord,
} from "@/components/services/material.service";
import { useAuth } from "@/lib/auth/AuthProvider";

/** Export = Add/Edit form fields in form order (keep in sync with the form). */
const MATERIAL_EXPORT_COLUMNS: ExportColumn<MaterialRecord>[] = [
  { header: "Material Code", value: (r) => r.code },
  { header: "Material Name", value: (r) => r.materialName },
  { header: "Material Category", value: (r) => r.category },
  { header: "HSN Code", value: (r) => r.hsnCode },
  { header: "Unit", value: (r) => r.unit },
  { header: "GST Percentage", value: (r) => r.gstPercentage },
  { header: "Status", value: (r) => r.status },
  { header: "Description / Remarks", value: (r) => r.description },
  createdOnColumn((r) => r.created_at),
];

const PAGE_SIZE = 10;

export default function MaterialListPage() {
  const { isCreator } = useAuth();
  const canDelete = isCreator;
  const [materials, setMaterials] = useState<MaterialRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<MaterialRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<MaterialRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);

  useEffect(() => {
    loadMaterials();
  }, []);

  async function loadMaterials() {
    try {
      setLoading(true);
      const data = await getMaterials({ includeInactive: true });
      setMaterials(data);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load materials.");
    } finally {
      setLoading(false);
    }
  }

  const filteredMaterials = useMemo(() => {
    const query = search.trim().toLowerCase();

    return materials.filter((material) => {
      const matchesSearch =
        !query ||
        matchesListSearch(query, [material.code, material.materialName, material.category, material.hsnCode, material.status]);

      const matchesStatus = !statusFilter || material.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [materials, search, statusFilter]);

  function handleAdd() {
    setEditingMaterial(null);
    setDialogOpen(true);
  }

  function handleEdit(material: MaterialRecord) {
    setEditingMaterial(material);
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) setEditingMaterial(null);
  }

  async function handleSubmit(values: Material) {
    try {
      setSaving(true);

      if (editingMaterial) {
        await updateMaterial(editingMaterial.id, values);
        toast.success("Material updated successfully.");
      } else {
        await createMaterial(values);
        toast.success("Material created successfully.");
      }

      setDialogOpen(false);
      setEditingMaterial(null);
      await loadMaterials();
    } catch (error) {
      console.error(error);
      toast.error(getUserFacingError(error, editingMaterial ? "Unable to update material." : "Unable to create material."));
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;

    try {
      setDeleting(true);
      await deleteMaterial(deleteTarget.id);
      toast.success("Material deleted successfully.");
      setDeleteTarget(null);
      await loadMaterials();
    } catch (error) {
      console.error(error);
      toast.error(getUserFacingError(error, "Unable to delete material."));
    } finally {
      setDeleting(false);
    }
  }

  function handleExport() {
    exportCsv("materials", MATERIAL_EXPORT_COLUMNS, filteredMaterials);
  }


  async function handleDownloadTemplate() {
    try {
      await downloadMaterialUploadTemplate();
    } catch (error) {
      console.error(error);
      toast.error("Unable to generate the upload template.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Material Master"
        buttonText="Add Material"
        onAdd={handleAdd}
      />

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search material code, name, category, HSN, status..."
        onRefresh={loadMaterials}
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
            options: MATERIAL_STATUS_OPTIONS.map((status) => ({
              label: status,
              value: status,
            })),
            onChange: setStatusFilter,
          },
        ]}
      />

      <MaterialTable
        materials={filteredMaterials}
        loading={loading}
        pageSize={PAGE_SIZE}
        onEdit={handleEdit}
        onDelete={setDeleteTarget}
        canDelete={canDelete}
      />

      <MaterialDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        material={editingMaterial}
        loading={saving}
        onSubmit={handleSubmit}
      />

      <MaterialBulkUploadDialog
        open={bulkUploadOpen}
        onOpenChange={setBulkUploadOpen}
        existingMaterials={materials}
        onImported={loadMaterials}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete material"
        description={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.materialName}"? This action cannot be undone.`
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
