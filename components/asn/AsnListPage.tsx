"use client";

import { useEffect, useMemo, useState } from "react";
import { createdColumns, exportCsv, staffNameResolver, type ExportColumn } from "@/lib/exportColumns";
import { getStaffUsers } from "@/components/services/appUser.service";
import { matchesListSearch } from "@/lib/listSearch";
import { toast } from "sonner";
import { getUserFacingError } from "@/lib/errors/getUserFacingError";

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
import { STAFF_EDIT_WINDOW_EXPIRED_MESSAGE, canStaffEditRecord } from "@/lib/editWindow";

/** Export = Add/Edit form fields in form order (keep in sync with the form). */
const ASN_EXPORT_COLUMNS: ExportColumn<AsnRecord>[] = [
  { header: "ASN Number", value: (r) => r.asnNumber },
  { header: "ASN Date", value: (r) => r.asnDate },
  { header: "LR Number", value: (r) => r.lrNumber },
  { header: "LR Date", value: (r) => r.lrDate },
  { header: "Vehicle Number", value: (r) => r.vehicleNumber },
  { header: "Driver Name", value: (r) => r.driverName },
  { header: "Driver Contact Number", value: (r) => r.driverContact },
  { header: "Challan No. / Invoice Number", value: (r) => r.challanInvoiceNumber },
  { header: "Challan / Invoice Date", value: (r) => r.challanInvoiceDate },
  { header: "Supplier Net Weight (MT)", value: (r) => r.supplierNetWeight },
  { header: "Challan Qty (MT)", value: (r) => r.challanQty },
  { header: "Supplier Tare Weight (MT)", value: (r) => r.supplierTareWeight },
  { header: "Supplier Gross Weight (MT)", value: (r) => r.supplierGrossWeight },
  { header: "Expected Time of Arrival", value: (r) => r.expectedTimeOfArrival },
  { header: "Road Permit", value: (r) => r.roadPermit },
  { header: "Weightment Slip (link)", value: (r) => r.weightmentSlipUrl },
  { header: "Challan Copy Slip (link)", value: (r) => r.challanCopySlipUrl },
  { header: "LR Copy Slip (link)", value: (r) => r.lrCopySlipUrl },
];

const PAGE_SIZE = 10;

export default function AsnListPage() {
  const { hasPermission, hasAction, isCreator, isAdmin } = useAuth();
  const canCreate = hasPermission("asn_creations", "create_view");
  const canEdit =
    hasPermission("asn_creations", "edit") || hasAction("asn_creations", "edit");
  const canDelete = isCreator;
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
      matchesListSearch(query, [row.asnNumber, row.asnDate, row.lrNumber, row.vehicleNumber, row.expectedTimeOfArrival])
    );
  }, [asns, search]);

  function handleAdd() {
    setEditing(null);
    setDialogMode("create");
    setDialogOpen(true);
  }

  function handleEdit(asn: AsnRecord) {
    if (!canStaffEditRecord(isAdmin, canEdit, asn)) {
      toast.error(canEdit ? STAFF_EDIT_WINDOW_EXPIRED_MESSAGE : "You do not have permission to edit ASNs.");
      return;
    }
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
        if (!canStaffEditRecord(isAdmin, canEdit, editing)) {
          toast.error(STAFF_EDIT_WINDOW_EXPIRED_MESSAGE);
          return;
        }
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
      toast.error(getUserFacingError(error, editing ? "Unable to update ASN." : "Unable to create ASN."));
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
      toast.error(getUserFacingError(error, "Unable to delete ASN."));
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
        placeholder="Search ASN no., date, LR no., vehicle, arrival..."
        onRefresh={loadData}
        onExport={() =>
          void (async () => {
            const staff = await getStaffUsers().catch(() => []);
            const createdBy = staffNameResolver(staff);
            exportCsv("asn", [
              ...ASN_EXPORT_COLUMNS,
              ...createdColumns<AsnRecord>((r) => createdBy(r.createdBy), (r) => r.created_at),
            ], filtered);
          })()
        }
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
        isAdmin={isAdmin}
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
