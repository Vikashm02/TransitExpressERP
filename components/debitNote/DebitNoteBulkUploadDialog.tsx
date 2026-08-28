"use client";

import { useState } from "react";
import { toast } from "sonner";
import { UploadCloud } from "lucide-react";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";

import {
  parseAndValidateDebitNoteUpload,
  type DebitNoteUploadRow,
  type DebitNoteUploadRowError,
} from "./debitNoteBulkUpload";
import {
  createDebitNote,
  generateDebitNoteNumber,
} from "@/components/services/debitNote.service";
import { rollbackUploadBatch } from "@/components/services/uploadRollback.service";
import { getBillingParties, getBillingParty } from "@/components/services/billingParty.service";

interface DebitNoteBulkUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void | Promise<void>;
}

export default function DebitNoteBulkUploadDialog({
  open,
  onOpenChange,
  onImported,
}: DebitNoteBulkUploadDialogProps) {
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [hasParsed, setHasParsed] = useState(false);
  const [rows, setRows] = useState<DebitNoteUploadRow[]>([]);
  const [errors, setErrors] = useState<DebitNoteUploadRowError[]>([]);
  const [importing, setImporting] = useState(false);

  function resetState() {
    setFileName("");
    setHasParsed(false);
    setRows([]);
    setErrors([]);
  }

  function handleOpenChange(next: boolean) {
    if (importing) return;
    if (!next) resetState();
    onOpenChange(next);
  }

  async function handleFileSelect(file: File) {
    setFileName(file.name);
    setHasParsed(false);
    setRows([]);
    setErrors([]);

    try {
      setParsing(true);
      const billingParties = await getBillingParties();
      const result = await parseAndValidateDebitNoteUpload(file, billingParties);
      setRows(result.rows);
      setErrors(result.errors);
      setHasParsed(true);
    } catch (error) {
      console.error(error);
      toast.error("Unable to read this file. Confirm it's a valid .xlsx file based on the downloaded template.");
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (rows.length === 0) return;

    const createdIds: number[] = [];

    try {
      setImporting(true);

      // Sequential, not Promise.all: `generateDebitNoteNumber()` counts
      // each Billing Party's own existing Debit Notes to derive the next
      // number, so two rows for the same Billing Party only stay
      // collision-free if each row's create is awaited before the next
      // row's number is generated — mirrors CreditNoteBulkUploadDialog.
      for (const row of rows) {
        const billingParty = await getBillingParty(row.values.billingPartyId);
        const debitNoteNumber = await generateDebitNoteNumber(billingParty);
        const created = await createDebitNote({ ...row.values, debitNoteNumber });
        createdIds.push(created.id);
      }

      toast.success(`${rows.length} debit note${rows.length === 1 ? "" : "s"} imported successfully.`);
      resetState();
      onOpenChange(false);
      await onImported();
    } catch (error) {
      console.error(error);

      // All-or-nothing: roll back every Debit Note created so far in
      // this batch, the same compensating-rollback pattern already used
      // by the Credit Note, Customer Master, and Billing bulk uploads.
      await rollbackUploadBatch("debit_notes", createdIds).catch((rollbackError) =>
        console.error(rollbackError)
      );

      toast.error("Import failed partway through and was rolled back. No debit notes were added. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Bulk Upload Debit Notes"
      description="Upload a completed template to import multiple debit notes at once."
      loading={importing}
      loadingText="Importing debit notes..."
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={importing}
          >
            Cancel
          </Button>

          <Button
            onClick={handleImport}
            disabled={importing || parsing || rows.length === 0}
          >
            {importing
              ? "Importing..."
              : `Import ${rows.length > 0 ? rows.length : ""} Debit Note${rows.length === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={parsing || importing}
            onClick={() => document.getElementById("debit-note-bulk-upload-input")?.click()}
          >
            <UploadCloud className="mr-2 h-4 w-4" />
            Choose File
          </Button>

          <input
            id="debit-note-bulk-upload-input"
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
              e.target.value = "";
            }}
          />

          <span className="truncate text-sm text-muted-foreground">
            {fileName || "No file selected"}
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          Debit Note Number is auto-generated on import from each row&apos;s Billing Party — do not include it in the file.
        </p>

        {parsing && (
          <p className="text-sm text-muted-foreground">Reading and validating the file...</p>
        )}

        {!parsing && hasParsed && errors.length > 0 && (
          <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">
              {errors.length} row{errors.length === 1 ? "" : "s"} failed validation. Nothing was imported — fix
              these in the Excel file and upload it again.
            </p>

            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm text-destructive">
              {errors.flatMap((error) =>
                error.messages.map((message, index) => (
                  <li key={`${error.excelRow}-${index}`}>
                    Row {error.excelRow}: {message}
                  </li>
                ))
              )}
            </ul>
          </div>
        )}

        {!parsing && hasParsed && errors.length === 0 && rows.length > 0 && (
          <p className="text-sm font-medium text-success">
            {rows.length} debit note{rows.length === 1 ? "" : "s"} passed validation and{" "}
            {rows.length === 1 ? "is" : "are"} ready to import.
          </p>
        )}

        {!parsing && hasParsed && errors.length === 0 && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No data rows were found in the &quot;Upload Data&quot; sheet.
          </p>
        )}
      </div>
    </FormDialog>
  );
}
