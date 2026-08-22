"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileDown, IndianRupee, Upload, Wallet } from "lucide-react";

import PageHeader from "@/components/ui/PageHeader";
import LearningPageChrome from "@/components/help/LearningPageChrome";
import { financialsPageHelp } from "@/lib/help";
import SearchToolbar from "@/components/common/SearchToolbar";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import StatCard from "@/components/ui/StatCard";
import FormField from "@/components/ui/FormField";
import FormDatePicker from "@/components/ui/FormDatePicker";
import FormSelect from "@/components/ui/FormSelect";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import LorryExpenseDialog from "./LorryExpenseDialog";
import LorryExpenseBulkUploadDialog from "./LorryExpenseBulkUploadDialog";
import LorryExpenseTable, { type LorryExpenseListRow } from "./LorryExpenseTable";
import type { FinancialsLrCommercial, LorryExpense } from "./lorryExpense.schema";
import { LORRY_EXPENSE_STATUS_SELECT_OPTIONS } from "./lorryExpense.schema";
import { downloadLorryExpenseUploadTemplate } from "./lorryExpenseBulkUpload";

import {
  createLorryExpense,
  deleteLorryExpense,
  getBeneficiaryNameSuggestions,
  getBrokerNameSuggestions,
  getLorryExpenses,
  updateLorryExpense,
  type LorryExpenseRecord,
} from "@/components/services/lorryExpense.service";
import { getLRs, updateLRFinancials, type LRRecord } from "@/components/services/lr.service";
import { syncVehicleOwnerFromBroker } from "@/components/services/vehicle.service";
import { calculateLR } from "@/lib/calculations/lrCalculations";
import {
  calculateFinancialProfitLoss,
  calculateLorrySettlement,
} from "@/lib/calculations/lorrySettlement";
import { useAuth } from "@/lib/auth/AuthProvider";
import { isDraftEntry } from "@/lib/entryStatus";

/** Supabase / RPC authorization failures for Financials writes. */
function isFinancialsPermissionError(error: unknown): boolean {
  const err = error as { code?: string; message?: string; details?: string } | null;
  const text = `${err?.message ?? ""} ${err?.details ?? ""}`.toLowerCase();
  if (text.includes("not permitted to edit financials")) return true;
  // Postgres RLS denial on lorry_expenses insert/update
  if (err?.code === "42501") return true;
  if (text.includes("row-level security")) return true;
  return false;
}

const PAGE_SIZE = 10;

function money(value: number): string {
  return `₹ ${value.toFixed(2)}`;
}

/**
 * Financials landing (formerly Lorry Expenses). Filters by LR Date,
 * Broker, and Beneficiary. Permission key remains `lorry_expenses`.
 */
export default function LorryExpenseListPage() {
  const { hasPermission, hasAction } = useAuth();
  const canCreate = hasPermission("lorry_expenses", "create_view");
  const canEdit =
    hasPermission("lorry_expenses", "edit") || hasAction("lorry_expenses", "edit");
  const canContinueDraft = canCreate || canEdit;
  const canDelete = hasAction("lorry_expenses", "delete");

  const [expenses, setExpenses] = useState<LorryExpenseRecord[]>([]);
  const [lrs, setLrs] = useState<LRRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [brokerFilter, setBrokerFilter] = useState("");
  const [beneficiaryFilter, setBeneficiaryFilter] = useState("");
  const [expenseStatusFilter, setExpenseStatusFilter] = useState<"all" | "pending" | "completed">(
    "all"
  );
  const [brokerSuggestions, setBrokerSuggestions] = useState<string[]>([]);
  const [beneficiarySuggestions, setBeneficiarySuggestions] = useState<string[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<LorryExpenseRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LorryExpenseListRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [expenseData, lrData, brokers, beneficiaries] = await Promise.all([
        getLorryExpenses(),
        getLRs(),
        getBrokerNameSuggestions(),
        getBeneficiaryNameSuggestions(),
      ]);
      setExpenses(expenseData);
      setLrs(lrData);
      setBrokerSuggestions(brokers);
      setBeneficiarySuggestions(beneficiaries);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load Financials.");
    } finally {
      setLoading(false);
    }
  }

  const rows: LorryExpenseListRow[] = useMemo(
    () =>
      expenses
        .map((expense) => {
          const lr = lrs.find((record) => String(record.id) === String(expense.lrId));
          const calc = lr ? calculateLR(lr) : null;
          const settlement = calculateLorrySettlement({
            lorryHireAmount: calc?.lorryHireAmount ?? 0,
            driverAdvance: expense.driverAdvance,
            driverAdvance2: expense.driverAdvance2,
            dieselAdvance: expense.dieselAdvance,
            loadingCharges: expense.loadingCharges,
            unloadingCharges: expense.unloadingCharges,
            detentionCharges: expense.detentionCharges,
            hamali: expense.hamali,
            commission: expense.commission,
            otherExpense: expense.otherExpense,
            stChalan: expense.stChalan,
            otherDeduction: expense.otherDeduction,
            finalAmountPaid: expense.finalAmountPaid,
            tdsPercentage: expense.tdsPercentage,
          });
          const billAmount = calc?.billAmount ?? 0;
          const profitLoss = calculateFinancialProfitLoss(billAmount, settlement.totalExpenses);

          return {
            ...expense,
            lrNumber: lr?.lrNumber ?? "",
            lrDate: lr?.lrDate ?? "",
            consignor: lr?.consignor ?? "",
            consignee: lr?.consignee ?? "",
            vehicleNumber: lr?.vehicleNumber ?? "",
            billAmount,
            lorryHireAmount: calc?.lorryHireAmount ?? 0,
            totalExpenses: settlement.totalExpenses,
            balancePayable: settlement.balancePayable,
            profitLoss,
            totalPaid:
              expense.driverAdvance + expense.driverAdvance2 + expense.finalAmountPaid,
          };
        })
        .filter((row) => Boolean(row.lrNumber)),
    [expenses, lrs]
  );

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const brokerQ = brokerFilter.trim().toLowerCase();
    const beneficiaryQ = beneficiaryFilter.trim().toLowerCase();

    return rows.filter((row) => {
      if (fromDate && (!row.lrDate || row.lrDate < fromDate)) return false;
      if (toDate && (!row.lrDate || row.lrDate > toDate)) return false;
      if (brokerQ && !row.brokerName.toLowerCase().includes(brokerQ)) return false;
      if (beneficiaryQ && !row.beneficiaryName.toLowerCase().includes(beneficiaryQ)) {
        return false;
      }
      if (expenseStatusFilter !== "all" && row.expenseStatus !== expenseStatusFilter) {
        return false;
      }
      if (!query) return true;
      return [row.lrNumber, row.consignor, row.consignee, row.vehicleNumber, row.brokerName, row.beneficiaryName]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(query));
    });
  }, [rows, search, fromDate, toDate, brokerFilter, beneficiaryFilter, expenseStatusFilter]);

  const stats = useMemo(() => {
    const totalExpenses = filteredRows.reduce((sum, row) => sum + row.totalExpenses, 0);
    const totalBalancePayable = filteredRows.reduce((sum, row) => sum + row.balancePayable, 0);
    return { totalExpenses, totalBalancePayable, count: filteredRows.length };
  }, [filteredRows]);

  const partySummary = useMemo(() => {
    const brokerActive = brokerFilter.trim().length > 0;
    const beneficiaryActive = beneficiaryFilter.trim().length > 0;
    if (!brokerActive && !beneficiaryActive) return null;

    return {
      label: brokerActive && beneficiaryActive
        ? "Broker + Beneficiary"
        : brokerActive
          ? "Broker"
          : "Beneficiary",
      totalLrs: filteredRows.length,
      totalLorryHire: filteredRows.reduce((sum, row) => sum + row.lorryHireAmount, 0),
      totalPaid: filteredRows.reduce((sum, row) => sum + row.totalPaid, 0),
      totalPending: filteredRows.reduce((sum, row) => sum + row.balancePayable, 0),
    };
  }, [filteredRows, brokerFilter, beneficiaryFilter]);

  function handleAdd() {
    setEditingExpense(null);
    setDialogOpen(true);
  }

  function handleEdit(row: LorryExpenseListRow) {
    if (isDraftEntry(row.entryStatus)) return;
    if (!canEdit) {
      toast.error("You do not have permission to edit finalized Financials.");
      return;
    }
    const expense = expenses.find((item) => item.id === row.id) ?? null;
    setEditingExpense(expense);
    setDialogOpen(true);
  }

  function handleContinueDraft(row: LorryExpenseListRow) {
    if (!isDraftEntry(row.entryStatus)) return;
    if (!canContinueDraft) {
      toast.error("You do not have permission to continue this draft.");
      return;
    }
    const expense = expenses.find((item) => item.id === row.id) ?? null;
    setEditingExpense(expense);
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) setEditingExpense(null);
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;

    try {
      setDeleting(true);
      await deleteLorryExpense(deleteTarget.id);
      toast.success("Financials entry deleted successfully.");
      setDeleteTarget(null);
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error("Unable to delete Financials entry.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleAutosave(
    values: LorryExpense,
    existingId: number | null
  ): Promise<number | null> {
    const draftValues = { ...values, entryStatus: "draft" as const };
    if (existingId) {
      const updated = await updateLorryExpense(existingId, draftValues);
      setEditingExpense(updated);
      return updated.id;
    }
    const created = await createLorryExpense(draftValues);
    setEditingExpense(created);
    await loadData();
    return created.id;
  }

  async function handleSubmit(
    values: LorryExpense,
    existingId: number | null,
    commercial: FinancialsLrCommercial
  ) {
    try {
      setSaving(true);

      const linkedLr = lrs.find((record) => String(record.id) === String(values.lrId));
      if (!linkedLr) {
        toast.error("Linked LR was not found.");
        return;
      }

      // Narrow Financials RPC — does not use updateLR() / lr.edit.
      await updateLRFinancials(String(linkedLr.id), {
        billRate: commercial.billRate,
        billRateType: commercial.billRateType,
        guaranteedWeight: commercial.guaranteedWeight,
        lorryHireRate: commercial.lorryHireRate,
        lorryHireType: commercial.lorryHireType,
        lorryHireGuaranteedWeight: commercial.lorryHireGuaranteedWeight,
      });

      if (existingId) {
        if (editingExpense && isDraftEntry(editingExpense.entryStatus)) {
          if (!canContinueDraft) {
            toast.error("You do not have permission to continue this draft.");
            return;
          }
        } else if (!canEdit) {
          toast.error("You do not have permission to edit finalized Financials.");
          return;
        }
        await updateLorryExpense(existingId, { ...values, entryStatus: "final" });
      } else {
        await createLorryExpense({ ...values, entryStatus: "final" });
      }

      // Broker → Vehicle Master owner_name only after Financials save succeeds.
      try {
        await syncVehicleOwnerFromBroker({
          vehicleNumber: linkedLr.vehicleNumber,
          brokerName: values.brokerName,
        });
        toast.success(
          existingId
            ? "Financials updated successfully."
            : "Financials saved successfully."
        );
      } catch (syncError) {
        console.error(syncError);
        toast.error(
          "Financials save हो गया, लेकिन Vehicle Master Owner update नहीं हुआ।"
        );
      }

      setDialogOpen(false);
      setEditingExpense(null);
      await loadData();
    } catch (error) {
      console.error(error);
      if (isFinancialsPermissionError(error)) {
        toast.error("You do not have permission to edit Financials for this LR.");
      } else {
        toast.error("Unable to save Financials.");
      }
    } finally {
      setSaving(false);
    }
  }

  const editingLR = editingExpense
    ? lrs.find((lr) => String(lr.id) === String(editingExpense.lrId)) ?? null
    : null;

  async function handleDownloadTemplate() {
    try {
      await downloadLorryExpenseUploadTemplate();
    } catch (error) {
      console.error(error);
      toast.error("Unable to generate the upload template.");
    }
  }

  function clearFilters() {
    setFromDate("");
    setToDate("");
    setBrokerFilter("");
    setBeneficiaryFilter("");
    setExpenseStatusFilter("all");
  }

  return (
    <div className="space-y-6">
      <LearningPageChrome content={financialsPageHelp} className="-mb-2" />
      <PageHeader
        title="Financials"
        buttonText="Add Financials"
        onAdd={handleAdd}
        showAddButton={canCreate}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard icon={Wallet} title="LRs with Financials" value={stats.count} />
        <StatCard
          icon={IndianRupee}
          title="Total Expenses"
          value={money(stats.totalExpenses)}
        />
        <StatCard
          icon={IndianRupee}
          title="Total Balance Payable"
          value={money(stats.totalBalancePayable)}
        />
      </div>

      <div className="rounded-xl border border-orange-200/70 bg-orange-50/40 p-4 dark:bg-orange-950/20">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-orange-900 dark:text-orange-200">
            Filters
          </h3>
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            Clear
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <FormDatePicker
            label="From Date (LR Date)"
            id="fin-from-date"
            value={fromDate}
            onChange={setFromDate}
          />
          <FormDatePicker
            label="To Date (LR Date)"
            id="fin-to-date"
            value={toDate}
            onChange={setToDate}
          />
          <FormField label="Broker Name" htmlFor="fin-filter-broker">
            <Input
              id="fin-filter-broker"
              list="fin-filter-broker-list"
              value={brokerFilter}
              onChange={(e) => setBrokerFilter(e.target.value)}
              placeholder="All brokers"
              autoComplete="off"
            />
            <datalist id="fin-filter-broker-list">
              {brokerSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </FormField>
          <FormField label="Beneficiary Name" htmlFor="fin-filter-beneficiary">
            <Input
              id="fin-filter-beneficiary"
              list="fin-filter-beneficiary-list"
              value={beneficiaryFilter}
              onChange={(e) => setBeneficiaryFilter(e.target.value)}
              placeholder="All beneficiaries"
              autoComplete="off"
            />
            <datalist id="fin-filter-beneficiary-list">
              {beneficiarySuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </FormField>
          <FormSelect
            label="Expense Status"
            id="fin-filter-expense-status"
            value={expenseStatusFilter}
            onValueChange={(value) =>
              setExpenseStatusFilter(value as "all" | "pending" | "completed")
            }
            options={[
              { value: "all", label: "All" },
              ...LORRY_EXPENSE_STATUS_SELECT_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              })),
            ]}
          />
        </div>

        {partySummary && (
          <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-orange-200 bg-card p-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">{partySummary.label} — Total LRs</p>
              <p className="text-base font-semibold">{partySummary.totalLrs}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Lorry Hire</p>
              <p className="text-base font-semibold">{money(partySummary.totalLorryHire)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Paid</p>
              <p className="text-base font-semibold">{money(partySummary.totalPaid)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Pending</p>
              <p className="text-base font-semibold text-orange-700 dark:text-orange-400">
                {money(partySummary.totalPending)}
              </p>
            </div>
          </div>
        )}
      </div>

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search by LR number, consignor, consignee, vehicle, broker or beneficiary..."
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
        onContinueDraft={handleContinueDraft}
        onDelete={setDeleteTarget}
        canEdit={canEdit}
        canContinueDraft={canContinueDraft}
        canDelete={canDelete}
      />

      <LorryExpenseDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        lorryExpense={editingExpense}
        lr={editingLR}
        loading={saving}
        onSubmit={handleSubmit}
        onAutosave={canContinueDraft ? handleAutosave : undefined}
      />

      <LorryExpenseBulkUploadDialog
        open={bulkUploadOpen}
        onOpenChange={setBulkUploadOpen}
        existingLRs={lrs}
        existingLorryExpenses={expenses}
        onImported={loadData}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Financials entry"
        description={
          deleteTarget
            ? `Are you sure you want to delete Financials for LR "${deleteTarget.lrNumber}"? This action cannot be undone.`
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
