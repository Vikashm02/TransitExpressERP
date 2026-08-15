"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileDown, IndianRupee, Upload, Wallet } from "lucide-react";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import StatCard from "@/components/ui/StatCard";
import FormField from "@/components/ui/FormField";
import FormDatePicker from "@/components/ui/FormDatePicker";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import LorryExpenseDialog from "./LorryExpenseDialog";
import LorryExpenseBulkUploadDialog from "./LorryExpenseBulkUploadDialog";
import LorryExpenseTable, { type LorryExpenseListRow } from "./LorryExpenseTable";
import type { FinancialsLrCommercial, LorryExpense } from "./lorryExpense.schema";
import { downloadLorryExpenseUploadTemplate } from "./lorryExpenseBulkUpload";

import {
  createLorryExpense,
  getBeneficiaryNameSuggestions,
  getBrokerNameSuggestions,
  getLorryExpenses,
  updateLorryExpense,
  type LorryExpenseRecord,
} from "@/components/services/lorryExpense.service";
import { getLRs, updateLR, type LRRecord } from "@/components/services/lr.service";
import { calculateLR } from "@/lib/calculations/lrCalculations";
import {
  calculateFinancialProfitLoss,
  calculateLorrySettlement,
} from "@/lib/calculations/lorrySettlement";
import type { BillRateType, LorryHireType } from "@/components/lr/lr.schema";
import { useAuth } from "@/lib/auth/AuthProvider";

const PAGE_SIZE = 10;

function money(value: number): string {
  return `₹ ${value.toFixed(2)}`;
}

/**
 * Financials landing (formerly Lorry Expenses). Filters by LR Date,
 * Broker, and Beneficiary. Permission key remains `lorry_expenses`.
 */
export default function LorryExpenseListPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("lorry_expenses", "create_view");
  const canEdit = hasPermission("lorry_expenses", "edit");

  const [expenses, setExpenses] = useState<LorryExpenseRecord[]>([]);
  const [lrs, setLrs] = useState<LRRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [brokerFilter, setBrokerFilter] = useState("");
  const [beneficiaryFilter, setBeneficiaryFilter] = useState("");
  const [brokerSuggestions, setBrokerSuggestions] = useState<string[]>([]);
  const [beneficiarySuggestions, setBeneficiarySuggestions] = useState<string[]>([]);

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
          const lr = lrs.find((record) => record.id === expense.lrId);
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
      if (!query) return true;
      return [row.lrNumber, row.consignor, row.consignee, row.vehicleNumber, row.brokerName, row.beneficiaryName]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(query));
    });
  }, [rows, search, fromDate, toDate, brokerFilter, beneficiaryFilter]);

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
    const expense = expenses.find((item) => item.id === row.id) ?? null;
    setEditingExpense(expense);
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) setEditingExpense(null);
  }

  async function handleSubmit(
    values: LorryExpense,
    existingId: number | null,
    commercial: FinancialsLrCommercial
  ) {
    try {
      setSaving(true);

      const linkedLr = lrs.find((record) => record.id === values.lrId);
      if (!linkedLr) {
        toast.error("Linked LR was not found.");
        return;
      }

      await updateLR(linkedLr.id, {
        ...linkedLr,
        billRate: commercial.billRate,
        billRateType: commercial.billRateType as BillRateType,
        guaranteedWeight: commercial.guaranteedWeight,
        lorryHireRate: commercial.lorryHireRate,
        lorryHireType: commercial.lorryHireType as LorryHireType,
        lorryHireGuaranteedWeight: commercial.lorryHireGuaranteedWeight,
      });

      if (existingId) {
        await updateLorryExpense(existingId, values);
        toast.success("Financials updated successfully.");
      } else {
        await createLorryExpense(values);
        toast.success("Financials saved successfully.");
      }

      setDialogOpen(false);
      setEditingExpense(null);
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error("Unable to save Financials.");
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

  function clearFilters() {
    setFromDate("");
    setToDate("");
    setBrokerFilter("");
    setBeneficiaryFilter("");
  }

  return (
    <div className="space-y-6">
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
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
