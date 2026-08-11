"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileDown, FileMinus2, IndianRupee, Upload } from "lucide-react";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import StatCard from "@/components/ui/StatCard";
import CreditNoteDialog, { type CreditNoteDialogMode } from "./CreditNoteDialog";
import CreditNoteBulkUploadDialog from "./CreditNoteBulkUploadDialog";
import CreditNoteTable from "./CreditNoteTable";
import type { CreditNote } from "./creditNote.schema";
import { downloadCreditNoteUploadTemplate } from "./creditNoteBulkUpload";

import {
  createCreditNote,
  generateCreditNoteNumber,
  getCreditNotes,
  updateCreditNote,
  type CreditNoteRecord,
} from "@/components/services/creditNote.service";
import { getBillingParty } from "@/components/services/billingParty.service";
import { useAuth } from "@/lib/auth/AuthProvider";

const PAGE_SIZE = 10;

export default function CreditNoteListPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("credit_notes", "create_view");
  const canEdit = hasPermission("credit_notes", "edit");

  const [creditNotes, setCreditNotes] = useState<CreditNoteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<CreditNoteDialogMode>("create");
  const [activeCreditNote, setActiveCreditNote] = useState<CreditNoteRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);

  useEffect(() => {
    loadCreditNotes();
  }, []);

  async function loadCreditNotes() {
    try {
      setLoading(true);
      const data = await getCreditNotes();
      setCreditNotes(data);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load credit notes.");
    } finally {
      setLoading(false);
    }
  }

  const filteredCreditNotes = useMemo(() => {
    const query = search.trim().toLowerCase();

    return creditNotes.filter((note) => {
      if (!query) return true;
      return [note.creditNoteNumber, note.billingPartyName]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(query));
    });
  }, [creditNotes, search]);

  const stats = useMemo(() => {
    const totalAmount = creditNotes.reduce((sum, note) => sum + note.amount, 0);
    const totalDeduction = creditNotes.reduce((sum, note) => sum + note.deduction, 0);
    const totalNet = creditNotes.reduce((sum, note) => sum + note.netAmount, 0);
    return { totalAmount, totalDeduction, totalNet };
  }, [creditNotes]);

  function handleAdd() {
    setActiveCreditNote(null);
    setDialogMode("create");
    setDialogOpen(true);
  }

  function handleView(note: CreditNoteRecord) {
    setActiveCreditNote(note);
    setDialogMode("view");
    setDialogOpen(true);
  }

  function handleEdit(note: CreditNoteRecord) {
    setActiveCreditNote(note);
    setDialogMode("edit");
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) setActiveCreditNote(null);
  }

  async function handleSubmit(values: CreditNote) {
    try {
      setSaving(true);

      if (dialogMode === "edit" && activeCreditNote) {
        await updateCreditNote(activeCreditNote.id, values);
        toast.success(`Credit Note ${activeCreditNote.creditNoteNumber} updated successfully.`);
      } else {
        // Number is generated last, right before the insert, from the
        // selected Billing Party's Short Code + that party's own
        // Credit Note count — never a shared/global counter.
        const billingParty = await getBillingParty(values.billingPartyId);
        const creditNoteNumber = await generateCreditNoteNumber(billingParty);
        await createCreditNote({ ...values, creditNoteNumber });
        toast.success(`Credit Note ${creditNoteNumber} created successfully.`);
      }

      setDialogOpen(false);
      setActiveCreditNote(null);
      await loadCreditNotes();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Unable to save credit note.");
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    const headers = ["Credit Note No.", "Date", "Billing Party", "Amount", "Discount/Deduction", "Net Credit"];

    const rows = filteredCreditNotes.map((note) => [
      note.creditNoteNumber,
      note.noteDate,
      note.billingPartyName,
      note.amount,
      note.deduction,
      note.netAmount,
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "credit-notes.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownloadTemplate() {
    try {
      await downloadCreditNoteUploadTemplate();
    } catch (error) {
      console.error(error);
      toast.error("Unable to generate the upload template.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Credit Note"
        buttonText="Create Credit Note"
        onAdd={handleAdd}
        showAddButton={canCreate}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          icon={FileMinus2}
          title="Total Credit Notes"
          value={creditNotes.length}
        />
        <StatCard
          icon={IndianRupee}
          title="Total Deduction"
          value={`₹ ${stats.totalDeduction.toFixed(2)}`}
        />
        <StatCard
          icon={IndianRupee}
          title="Total Net Credit"
          value={`₹ ${stats.totalNet.toFixed(2)}`}
        />
      </div>

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search by credit note number or billing party..."
        onRefresh={loadCreditNotes}
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

      <CreditNoteTable
        creditNotes={filteredCreditNotes}
        loading={loading}
        pageSize={PAGE_SIZE}
        onView={handleView}
        onEdit={handleEdit}
        canEdit={canEdit}
      />

      <CreditNoteDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        mode={dialogMode}
        creditNote={activeCreditNote}
        loading={saving}
        onSubmit={handleSubmit}
      />

      <CreditNoteBulkUploadDialog
        open={bulkUploadOpen}
        onOpenChange={setBulkUploadOpen}
        onImported={loadCreditNotes}
      />
    </div>
  );
}
