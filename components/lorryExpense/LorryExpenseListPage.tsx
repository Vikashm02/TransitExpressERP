"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileDown, IndianRupee, Upload, Wallet } from "lucide-react";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import StatCard from "@/components/ui/StatCard";
import LorryExpenseDialog from "./LorryExpenseDialog";
import LorryExpenseBulkUploadDialog from "./LorryExpenseBulkUploadDialog";
import LorryExpenseTable, { type LorryExpenseListRow } from "./LorryExpenseTable";
import type { LorryExpense } from "./lorryExpense.schema";
import { downloadLorryExpenseUploadTemplate } from "./lorryExpenseBulkUpload";

import {
  createLorryExpense,
  getLorryExpenses,
  updateLorryExpense,
  type LorryExpenseRecord,
} from "@/components/services/lorryExpense.service";
import { getLRs, type LRRecord } from "@/components/services/lr.service";
import { calculateLR } from "@/lib/calculations/lrCalculations";
import { calculateLorrySettlement } from "@/lib/calculations/lorrySettlement";
import { useAuth } from "@/lib/auth/AuthProvider";

const PAGE_SIZE = 10;

/**
 * Lists Lorry Expenses. Because `getLRs()`/`getLorryExpenses()` are
 * both scoped by RLS (see migration 017) to the current user's own
 * assigned LRs — or every LR for an admin — this list is already
 * effectively "My Lorry Expenses" with zero extra filtering code.
 */
export default function LorryExpenseListPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("lorry_expenses", "create_view");
  const canEdit = hasPermission("lorry_expenses", "edit");

  const [expenses, setExpenses] = useState<LorryExpenseRecord[]>([]);
  const [lrs, setLrs] = useState<LRRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<LorryExpenseRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [expenseData, lrData] = await Promise.all([getLorryExpenses(), getLRs()]);
      setExpenses(expenseData);
      setLrs(lrData);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load Lorry Expenses.");
    } finally {
      setLoading(false);
    }
  }

  const rows: LorryExpenseListRow[] = useMemo(
    () =>
      expenses
        .map((expense) => {
          const lr = lrs.find((record) => record.id === expense.lrId);
          const lorryHireAmount = lr ? calculateLR(lr).lorryHireAmount : 0;
          const settlement = calculateLorrySettlement({
            lorryHireAmount,
            driverAdvance: expense.driverAdvance,
            dieselAdvance: expense.dieselAdvance,
            loadingCharges: expense.loadingCharges,
            unloadingCharges: expense.unloadingCharges,
            hamali: expense.hamali,
            commission: expense.commission,
            otherExpense: expense.otherExpense,
          });

          return {
            ...expense,
            lrNumber: lr?.lrNumber ?? "",
            consignor: lr?.consignor ?? "",
            consignee: lr?.consignee ?? "",
            vehicleNumber: lr?.vehicleNumber ?? "",
            lorryHireAmount,
            totalExpenses: settlement.totalExpenses,
            balancePayable: settlement.balancePayable,
          };
        })
        .filter((row) => Boolean(row.lrNumber)), // hides orphaned rows if an LR became invisible under RLS
    [expenses, lrs]
  );

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    return rows.filter((row) => {
      if (!query) return true;
      return [row.lrNumber, row.consignor, row.consignee, row.vehicleNumber]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(query));
    });
  }, [rows, search]);

  const stats = useMemo(() => {
    const totalExpenses = rows.reduce((sum, row) => sum + row.totalExpenses, 0);
    const totalBalancePayable = rows.reduce((sum, row) => sum + row.balancePayable, 0);
    return { totalExpenses, totalBalancePayable };
  }, [rows]);

  function handleAdd() {
    setEditingExpense(null);
    setDialogOpen(true);
  }

  function handleEdit(row: LorryExpenseListRow) {
    const expense = expenses.find((item) => item.id === row.id) ?? null;
    setEditingExpense(expense);
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) setEditingExpense(null);
  }

  async function handleSubmit(values: LorryExpense, existingId: number | null) {
    try {
      setSaving(true);

      if (existingId) {
        await updateLorryExpense(existingId, values);
        toast.success("Lorry Expenses updated successfully.");
      } else {
        await createLorryExpense(values);
        toast.success("Lorry Expenses saved successfully.");
      }

      setDialogOpen(false);
      setEditingExpense(null);
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error("Unable to save Lorry Expenses.");
    } finally {
      setSaving(false);
    }
  }

  const editingLR = editingExpense ? lrs.find((lr) => lr.id === editingExpense.lrId) ?? null : null;

  async function handleDownloadTemplate() {
    try {
      await downloadLorryExpenseUploadTemplate();
    } catch (error) {
      console.error(error);
      toast.error("Unable to generate the upload template.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lorry Expenses"
        buttonText="Add Lorry Expenses"
        onAdd={handleAdd}
        showAddButton={canCreate}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          icon={Wallet}
          title="LRs with Expenses"
          value={rows.length}
        />
        <StatCard
          icon={IndianRupee}
          title="Total Expenses"
          value={`₹ ${stats.totalExpenses.toFixed(2)}`}
        />
        <StatCard
          icon={IndianRupee}
          title="Total Balance Payable"
          value={`₹ ${stats.totalBalancePayable.toFixed(2)}`}
        />
      </div>

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search by LR number, consignor, consignee or vehicle number..."
        onRefresh={loadData}
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

      <LorryExpenseTable
        rows={filteredRows}
        loading={loading}
        pageSize={PAGE_SIZE}
        onEdit={handleEdit}
        canEdit={canEdit}
      />

      <LorryExpenseDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        lorryExpense={editingExpense}
        lr={editingLR}
        loading={saving}
        onSubmit={handleSubmit}
      />

      <LorryExpenseBulkUploadDialog
        open={bulkUploadOpen}
        onOpenChange={setBulkUploadOpen}
        existingLRs={lrs}
        existingLorryExpenses={expenses}
        onImported={loadData}
      />
    </div>
  );
}
