"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileDown, FileText, Receipt, Upload } from "lucide-react";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import StatCard from "@/components/ui/StatCard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import BillDialog from "./BillDialog";
import EditBillDialog from "./EditBillDialog";
import ShareBillDialog from "./ShareBillDialog";
import BillingBulkUploadDialog from "./BillingBulkUploadDialog";
import BillingTable from "./BillingTable";
import type { Bill } from "./billing.schema";
import { downloadBillingUploadTemplate } from "./billingBulkUpload";

import {
  createBill,
  deleteBill,
  getBills,
  type BillLineInput,
  type BillRecord,
} from "@/components/services/billing.service";
import { getCompany, saveCompany } from "@/components/services/company.service";
import { getLRs, updateLR } from "@/components/services/lr.service";
import { useAuth } from "@/lib/auth/AuthProvider";

const PAGE_SIZE = 10;

export default function BillingListPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("billing", "create_view");
  const canEdit = hasPermission("billing", "edit");

  const [bills, setBills] = useState<BillRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editTarget, setEditTarget] = useState<BillRecord | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const [shareBillId, setShareBillId] = useState<number | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<BillRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadBills();
  }, []);

  async function loadBills() {
    try {
      setLoading(true);
      const data = await getBills();
      setBills(data);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load bills.");
    } finally {
      setLoading(false);
    }
  }

  const filteredBills = useMemo(() => {
    const query = search.trim().toLowerCase();

    return bills.filter((bill) => {
      if (!query) return true;

      return [bill.billNumber, bill.billingPartyName]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(query));
    });
  }, [bills, search]);

  const stats = useMemo(() => {
    const totalFreight = bills.reduce((sum, bill) => sum + bill.grandTotal, 0);
    const totalLrs = bills.reduce((sum, bill) => sum + bill.lrCount, 0);
    return { totalFreight, totalLrs };
  }, [bills]);

  function handleAdd() {
    setDialogOpen(true);
  }

  function handleView(bill: BillRecord) {
    window.open(`/billing/${bill.id}/print`, "_blank", "noopener,noreferrer");
  }

  function handleEdit(bill: BillRecord) {
    setEditTarget(bill);
    setEditOpen(true);
  }

  function handleEditOpenChange(open: boolean) {
    setEditOpen(open);
    if (!open) setEditTarget(null);
  }

  function handlePrint(bill: BillRecord) {
    window.open(`/billing/${bill.id}/print?autoprint=1`, "_blank", "noopener,noreferrer");
  }

  function handleShare(bill: BillRecord) {
    setShareBillId(bill.id);
    setShareOpen(true);
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;

    try {
      setDeleting(true);
      await deleteBill(deleteTarget.id);
      toast.success(`Bill ${deleteTarget.billNumber} deleted successfully.`);
      setDeleteTarget(null);
      await loadBills();
    } catch (error) {
      console.error(error);
      toast.error("Unable to delete bill.");
    } finally {
      setDeleting(false);
    }
  }

  /** After a Bill is saved, every included LR is marked "Billed" — the
   * only field touched here. Reuses `updateLR()` with each LR's own full
   * record (unchanged) plus `status`, exactly like POD's
   * `markLRDelivered()` marks an LR "Delivered". No LR business logic,
   * calculations, or other fields are modified.
   *
   * `lrIds` are strings (`lrs.id` is `uuid` live, not `bigint`) —
   * `String(lr.id)` below is a no-op on `LRRecord.id`'s real runtime
   * value, just a type-safe way to compare it against `lrIds`. */
  async function markLRsBilled(lrIds: string[]) {
    const lrs = await getLRs();
    const targets = lrs.filter((lr) => lrIds.includes(String(lr.id)) && lr.status !== "Billed");
    await Promise.all(targets.map((lr) => updateLR(lr.id, { ...lr, status: "Billed" })));
  }

  async function handleSubmit(values: Bill, lines: BillLineInput[]) {
    try {
      setSaving(true);

      // Automatic Bill Number generation: Invoice Prefix + zero-padded
      // next running number, both from Company Master Document Settings
      // — the exact same pattern LRListPage.tsx uses for LR Number. The
      // running number only advances after `createBill` actually
      // succeeds; a failed save never consumes a number.
      const company = await getCompany();

      if (!company) {
        toast.error("Configure Company Settings (Invoice Prefix) before creating a Bill.");
        return;
      }

      const nextRunningNumber = (company.invoiceRunningNumber ?? 0) + 1;
      const billNumber = `${company.invoicePrefix}${String(nextRunningNumber).padStart(
        company.invoicePrefixLength || 4,
        "0"
      )}`;

      await createBill({ ...values, billNumber }, lines);
      await saveCompany({ ...company, invoiceRunningNumber: nextRunningNumber }, company.id);
      await markLRsBilled(values.lrIds);

      toast.success(`Bill ${billNumber} created successfully.`);
      setDialogOpen(false);
      await loadBills();
    } catch (error) {
      console.error(error);
      toast.error("Unable to create bill.");
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    const headers = ["Bill Number", "Bill Date", "Billing Party", "No. of LRs", "Total Amount"];

    const rows = filteredBills.map((bill) => [
      bill.billNumber,
      bill.billDate,
      bill.billingPartyName,
      bill.lrCount,
      bill.grandTotal,
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
    link.download = "bills.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownloadTemplate() {
    try {
      await downloadBillingUploadTemplate();
    } catch (error) {
      console.error(error);
      toast.error("Unable to generate the upload template.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        buttonText="Create Bill"
        onAdd={handleAdd}
        showAddButton={canCreate}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          icon={Receipt}
          title="Total Bills"
          value={bills.length}
        />
        <StatCard
          icon={FileText}
          title="Total LRs Billed"
          value={stats.totalLrs}
        />
        <StatCard
          icon={Receipt}
          title="Total Billed Amount"
          value={`₹ ${stats.totalFreight.toFixed(2)}`}
        />
      </div>

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search by bill number or billing party..."
        onRefresh={loadBills}
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

      <BillingTable
        bills={filteredBills}
        loading={loading}
        pageSize={PAGE_SIZE}
        onView={handleView}
        onEdit={handleEdit}
        onPrint={handlePrint}
        onShare={handleShare}
        onDelete={setDeleteTarget}
        canEdit={canEdit}
      />

      <BillDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        loading={saving}
        onSubmit={handleSubmit}
      />

      <EditBillDialog
        open={editOpen}
        onOpenChange={handleEditOpenChange}
        bill={editTarget}
        onSaved={loadBills}
      />

      <ShareBillDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        billId={shareBillId}
      />

      <BillingBulkUploadDialog
        open={bulkUploadOpen}
        onOpenChange={setBulkUploadOpen}
        onImported={loadBills}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete bill"
        description={
          deleteTarget
            ? `Are you sure you want to delete Bill "${deleteTarget.billNumber}"? This action cannot be undone.`
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
