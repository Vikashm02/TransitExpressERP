"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Banknote, FileText, PackageCheck, Truck } from "lucide-react";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FormDialog from "@/components/ui/FormDialog";
import FormSelect from "@/components/ui/FormSelect";
import { Button } from "@/components/ui/button";
import StatCard from "@/components/ui/StatCard";
import LRDialog from "./LRDialog";
import LRTable from "./LRTable";
import ShareLRDialog from "./ShareLRDialog";
import { FREIGHT_TYPE_OPTIONS, LR_STATUS_OPTIONS, type LR } from "./lr.schema";

import {
  createLR,
  deleteLR,
  getLRs,
  reassignLR,
  updateLR,
  type LRRecord,
} from "@/components/services/lr.service";
import { getCompany, saveCompany } from "@/components/services/company.service";
import { getStaffUsers, type AppUserProfile } from "@/components/services/appUser.service";
import { useAuth } from "@/lib/auth/AuthProvider";

const PAGE_SIZE = 10;

export default function LRListPage() {
  const { isAdmin, hasPermission } = useAuth();
  const canCreate = hasPermission("lr", "create_view");
  const canEdit = hasPermission("lr", "edit");

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
    setEditingLR(null);
    setDialogOpen(true);
  }

  function handleEdit(lr: LRRecord) {
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

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) setEditingLR(null);
  }

  async function handleSubmit(values: LR) {
    try {
      setSaving(true);

      if (editingLR) {
        await updateLR(editingLR.id, values);
        toast.success("LR updated successfully.");
      } else {
        // Automatic LR Number Generation: LR Prefix + zero-padded next
        // running number, both from Company Master Document Settings. The
        // running number only advances after `createLR` actually succeeds
        // (see below) — a failed save never consumes a number.
        const company = await getCompany();

        if (!company) {
          toast.error("Configure Company Settings (LR Prefix) before creating an LR.");
          return;
        }

        const nextRunningNumber = (company.lrRunningNumber ?? 0) + 1;
        const lrNumber = `${company.lrPrefix}${String(nextRunningNumber).padStart(
          company.lrPrefixLength || 4,
          "0"
        )}`;

        await createLR({ ...values, lrNumber });
        await saveCompany({ ...company, lrRunningNumber: nextRunningNumber }, company.id);

        toast.success(`LR ${lrNumber} created successfully.`);
      }

      setDialogOpen(false);
      setEditingLR(null);
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

  return (
    <div className="space-y-6">
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
        onDelete={setDeleteTarget}
        onPrint={handlePrint}
        onShare={handleShare}
        isAdmin={isAdmin}
        onReassign={handleReassign}
        resolveAssignedName={resolveAssignedName}
        canEdit={canEdit}
      />

      <LRDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        lr={editingLR}
        loading={saving}
        onSubmit={handleSubmit}
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
