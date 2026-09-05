"use client";

import { useState } from "react";
import { toast } from "sonner";
import { UploadCloud } from "lucide-react";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";

import { parseAndValidateLRUpload, type LRUploadRow, type LRUploadRowError } from "./lrBulkUpload";
import { createHistoricalLrBulk, getLRs } from "@/components/services/lr.service";
import { getCompany } from "@/components/services/company.service";
import { getLrBillingPartyLookup } from "@/components/services/billingParty.service";
import { getLrCustomerLookup } from "@/components/services/customer.service";
import { getLrMaterialLookup } from "@/components/services/material.service";

interface LRBulkUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void | Promise<void>;
}

function historicalBulkErrorMessage(error: unknown): string {
  const raw =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : error instanceof Error
        ? error.message
        : "";

  const trimmed = raw.trim();
  if (!trimmed) {
    return "Bulk upload failed. No LR records were imported.";
  }

  // Prefer actionable RPC messages (Row N: …); strip PostgREST noise prefixes.
  const rowMatch = /Row \d+:[\s\S]*/i.exec(trimmed);
  const detail = (rowMatch?.[0] ?? trimmed)
    .replace(/^.*?(?=Row \d+:)/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (detail.length > 0 && detail.length < 400) {
    return `Bulk upload failed. No LR records were imported. ${detail}`;
  }

  return "Bulk upload failed. No LR records were imported.";
}

export default function LRBulkUploadDialog({
  open,
  onOpenChange,
  onImported,
}: LRBulkUploadDialogProps) {
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [hasParsed, setHasParsed] = useState(false);
  const [rows, setRows] = useState<LRUploadRow[]>([]);
  const [errors, setErrors] = useState<LRUploadRowError[]>([]);
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
      const [billingParties, materials, customers, company, existingLrs] = await Promise.all([
        getLrBillingPartyLookup(),
        getLrMaterialLookup(),
        getLrCustomerLookup(),
        getCompany(),
        getLRs(),
      ]);

      if (!company) {
        toast.error("Company settings are not configured. Configure LR prefix settings before bulk upload.");
        setHasParsed(true);
        setRows([]);
        setErrors([
          {
            excelRow: 1,
            messages: ["Company settings are not configured."],
          },
        ]);
        return;
      }

      const result = await parseAndValidateLRUpload(
        file,
        billingParties,
        materials,
        customers,
        {
          prefix: company.lrPrefix || "LR",
          prefixLength: company.lrPrefixLength || 4,
          runningNumber: company.lrRunningNumber ?? 0,
        },
        existingLrs.map((lr) => lr.lrNumber),
      );
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

    try {
      setImporting(true);

      // One atomic RPC for the entire batch (migration 070).
      // No sequential createLR(); no rollbackUploadBatch compensation.
      const result = await createHistoricalLrBulk(
        rows.map((row) => ({ excelRow: row.excelRow, values: row.values })),
      );

      toast.success(
        `${result.count} LR${result.count === 1 ? "" : "s"} imported successfully.`,
      );
      resetState();
      onOpenChange(false);
      await onImported();
    } catch (error) {
      console.error(error);
      toast.error(historicalBulkErrorMessage(error));
    } finally {
      setImporting(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Bulk Upload LRs"
      description="Upload a completed template to import historical LRs. Enter numeric LR numbers only (e.g. 19305). Numbers must be older than the current running LR and must not already exist."
      loading={importing}
      loadingText="Importing LRs..."
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
              : `Import ${rows.length > 0 ? rows.length : ""} LR${rows.length === 1 ? "" : "s"}`}
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
            onClick={() => document.getElementById("lr-bulk-upload-input")?.click()}
          >
            <UploadCloud className="mr-2 h-4 w-4" />
            Choose File
          </Button>

          <input
            id="lr-bulk-upload-input"
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
            {rows.length} LR{rows.length === 1 ? "" : "s"} passed validation and{" "}
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
