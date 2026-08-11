"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FilePlus2, IndianRupee } from "lucide-react";

import PageHeader from "@/components/ui/PageHeader";
import SearchToolbar from "@/components/common/SearchToolbar";
import StatCard from "@/components/ui/StatCard";
import DebitNoteDialog, { type DebitNoteDialogMode } from "./DebitNoteDialog";
import DebitNoteTable from "./DebitNoteTable";
import type { DebitNote } from "./debitNote.schema";

import {
  createDebitNote,
  generateDebitNoteNumber,
  getDebitNotes,
  updateDebitNote,
  type DebitNoteRecord,
} from "@/components/services/debitNote.service";
import { getBillingParty } from "@/components/services/billingParty.service";
import { useAuth } from "@/lib/auth/AuthProvider";

const PAGE_SIZE = 10;

export default function DebitNoteListPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("debit_notes", "create_view");
  const canEdit = hasPermission("debit_notes", "edit");

  const [debitNotes, setDebitNotes] = useState<DebitNoteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DebitNoteDialogMode>("create");
  const [activeDebitNote, setActiveDebitNote] = useState<DebitNoteRecord | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadDebitNotes();
  }, []);

  async function loadDebitNotes() {
    try {
      setLoading(true);
      const data = await getDebitNotes();
      setDebitNotes(data);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load debit notes.");
    } finally {
      setLoading(false);
    }
  }

  const filteredDebitNotes = useMemo(() => {
    const query = search.trim().toLowerCase();

    return debitNotes.filter((note) => {
      if (!query) return true;
      return [note.debitNoteNumber, note.billingPartyName]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(query));
    });
  }, [debitNotes, search]);

  const stats = useMemo(() => {
    const totalAmount = debitNotes.reduce((sum, note) => sum + note.amount, 0);
    const totalGst = debitNotes.reduce((sum, note) => sum + note.gstAmount, 0);
    const totalAmountWithGst = debitNotes.reduce((sum, note) => sum + note.totalAmount, 0);
    return { totalAmount, totalGst, totalAmountWithGst };
  }, [debitNotes]);

  function handleAdd() {
    setActiveDebitNote(null);
    setDialogMode("create");
    setDialogOpen(true);
  }

  function handleView(note: DebitNoteRecord) {
    setActiveDebitNote(note);
    setDialogMode("view");
    setDialogOpen(true);
  }

  function handleEdit(note: DebitNoteRecord) {
    setActiveDebitNote(note);
    setDialogMode("edit");
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) setActiveDebitNote(null);
  }

  async function handleSubmit(values: DebitNote) {
    try {
      setSaving(true);

      if (dialogMode === "edit" && activeDebitNote) {
        await updateDebitNote(activeDebitNote.id, values);
        toast.success(`Debit Note ${activeDebitNote.debitNoteNumber} updated successfully.`);
      } else {
        // Number is generated last, right before the insert, from the
        // selected Billing Party's Short Code + that party's own
        // Debit Note count — never a shared/global counter.
        const billingParty = await getBillingParty(values.billingPartyId);
        const debitNoteNumber = await generateDebitNoteNumber(billingParty);
        await createDebitNote({ ...values, debitNoteNumber });
        toast.success(`Debit Note ${debitNoteNumber} created successfully.`);
      }

      setDialogOpen(false);
      setActiveDebitNote(null);
      await loadDebitNotes();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Unable to save debit note.");
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    const headers = ["Debit Note No.", "Date", "Billing Party", "Amount", "GST", "Total"];

    const rows = filteredDebitNotes.map((note) => [
      note.debitNoteNumber,
      note.noteDate,
      note.billingPartyName,
      note.amount,
      note.gstPercentage,
      note.totalAmount,
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "debit-notes.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Debit Note"
        buttonText="Create Debit Note"
        onAdd={handleAdd}
        showAddButton={canCreate}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          icon={FilePlus2}
          title="Total Debit Notes"
          value={debitNotes.length}
        />
        <StatCard
          icon={IndianRupee}
          title="Total GST"
          value={`₹ ${stats.totalGst.toFixed(2)}`}
        />
        <StatCard
          icon={IndianRupee}
          title="Total Amount"
          value={`₹ ${stats.totalAmountWithGst.toFixed(2)}`}
        />
      </div>

      <SearchToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search by debit note number or billing party..."
        onRefresh={loadDebitNotes}
        onExport={handleExport}
      />

      <DebitNoteTable
        debitNotes={filteredDebitNotes}
        loading={loading}
        pageSize={PAGE_SIZE}
        onView={handleView}
        onEdit={handleEdit}
        canEdit={canEdit}
      />

      <DebitNoteDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        mode={dialogMode}
        debitNote={activeDebitNote}
        loading={saving}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
