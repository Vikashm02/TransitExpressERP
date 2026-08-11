"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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

const PAGE_SIZE = 10;

export default function MaterialListPage() {
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
      const data = await getMaterials();
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
        [material.code, material.materialName, material.category, material.hsnCode]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(query));

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
      toast.error(
        editingMaterial
          ? "Unable to update material."
          : "Unable to create material."
      );
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
      toast.error("Unable to delete material.");
    } finally {
      setDeleting(false);
    }
  }

  function handleExport() {
    const headers = [
      "Material Code",
      "Material Name",
      "Category",
      "HSN Code",
      "Unit",
      "GST Percentage",
      "Description",
      "Status",
    ];

    const rows = filteredMaterials.map((material) => [
      material.code,
      material.materialName,
      material.category,
      material.hsnCode,
      material.unit,
      material.gstPercentage,
      material.description,
      material.status,
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
    link.download = "materials.csv";
    link.click();
    URL.revokeObjectURL(url);
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
        placeholder="Search by material code, name, category or HSN code..."
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
