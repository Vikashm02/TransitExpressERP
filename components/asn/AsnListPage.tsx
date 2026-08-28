"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import PageHeader from "@/components/ui/PageHeader";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import SearchToolbar from "@/components/common/SearchToolbar";
import AsnDialog, { type AsnDialogMode } from "./AsnDialog";
import AsnTable from "./AsnTable";
import type { Asn } from "./asn.schema";
import {
  createAsn,
  deleteAsn,
  getAsns,
  updateAsn,
  type AsnRecord,
} from "@/components/services/asn.service";
import { useAuth } from "@/lib/auth/AuthProvider";

const PAGE_SIZE = 10;

export default function AsnListPage() {
  const { hasPermission, hasAction, isAdmin } = useAuth();
  const canCreate = hasPermission("asn_creations", "create_view");
  const canEdit =
    hasPermission("asn_creations", "edit") || hasAction("asn_creations", "edit");
  const canDelete = isAdmin;
  const canPrint = hasAction("asn_creations", "print");

  const [asns, setAsns] = useState<AsnRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AsnRecord | null>(null);
  const [dialogMode, setDialogMode] = useState<AsnDialogMode>("create");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AsnRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const data = await getAsns();
      setAsns(data);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load ASNs.");
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return asns;

    return asns.filter((row) =>
      [row.asnNumber, row.lrNumber, row.vehicleNumber]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(query))
    );
  }, [asns, search]);

  function handleAdd() {
    setEditing(null);
    setDialogMode("create");
    setDialogOpen(true);
  }

  function handleEdit(asn: AsnRecord) {
    setEditing(asn);
    setDialogMode("edit");
    setDialogOpen(true);
  }

  function handleView(asn: AsnRecord) {
    setEditing(asn);
    setDialogMode("view");
    setDialogOpen(true);
  }

  function handlePrint(asn: AsnRecord) {
    window.open(`/asn/${asn.id}/print`, "_blank", "noopener,noreferrer");
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      setEditing(null);
      setDialogMode("create");
    }
  }

  async function handleSubmit(values: Asn) {
    try {
      setSaving(true);

      if (editing) {
        await updateAsn(editing.id, values);
        toast.success("ASN updated successfully.");
      } else {
        await createAsn(values);
        toast.success("ASN created successfully.");
      }

      setDialogOpen(false);
      setEditing(null);
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error(editing ? "Unable to update ASN." : "Unable to create ASN.");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;

    try {
      setDeleting(true);
      await deleteAsn(deleteTarget.id);
      toast.success("ASN deleted successfully.");
      setDeleteTarget(null);
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error("Unable to delete ASN.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="ASN Creation"
        buttonText="Create ASN"
        onAdd={handleAdd}
        showAddButton={canCreate}
      />

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search by ASN number, LR number, vehicle..."
        onRefresh={loadData}
      />

      <AsnTable
        asns={filtered}
        loading={loading}
        pageSize={PAGE_SIZE}
        onView={handleView}
        onEdit={handleEdit}
        onPrint={handlePrint}
        onDelete={setDeleteTarget}
        canEdit={canEdit}
        canDelete={canDelete}
        canPrint={canPrint}
      />

      <AsnDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        mode={dialogMode}
        asn={editing}
        loading={saving}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete ASN"
        description={
          deleteTarget
            ? `Are you sure you want to delete ASN "${deleteTarget.asnNumber}"? This action cannot be undone.`
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
