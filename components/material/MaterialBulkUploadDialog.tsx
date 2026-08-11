"use client";

import { useState } from "react";
import { toast } from "sonner";
import { UploadCloud } from "lucide-react";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";

import {
  parseAndValidateMaterialUpload,
  type MaterialUploadRow,
  type MaterialUploadRowError,
} from "./materialBulkUpload";
import {
  createMaterial,
  deleteMaterial,
  type MaterialRecord,
} from "@/components/services/material.service";

interface MaterialBulkUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reuses the list already loaded by MaterialListPage — no extra fetch. */
  existingMaterials: MaterialRecord[];
  onImported: () => void | Promise<void>;
}

export default function MaterialBulkUploadDialog({
  open,
  onOpenChange,
  existingMaterials,
  onImported,
}: MaterialBulkUploadDialogProps) {
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [hasParsed, setHasParsed] = useState(false);
  const [rows, setRows] = useState<MaterialUploadRow[]>([]);
  const [errors, setErrors] = useState<MaterialUploadRowError[]>([]);
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
      const result = await parseAndValidateMaterialUpload(file, existingMaterials);
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

      // Sequential, not Promise.all: reuses createMaterial()'s existing
      // count()-based code generator as-is, which only stays collision-free
      // if each call is awaited before the next one starts.
      for (const row of rows) {
        const created = await createMaterial(row.values);
        createdIds.push(created.id);
      }

      toast.success(`${rows.length} material${rows.length === 1 ? "" : "s"} imported successfully.`);
      resetState();
      onOpenChange(false);
      await onImported();
    } catch (error) {
      console.error(error);

      // Best-effort compensating rollback for the rare case a row fails at
      // insert time despite passing validation (e.g. a race) — the same
      // pattern createBill() already uses in billing.service.ts, since
      // there's no multi-row transaction available here either.
      await Promise.all(
        createdIds.map((id) => deleteMaterial(id).catch((rollbackError) => console.error(rollbackError)))
      );

      toast.error("Import failed partway through and was rolled back. No materials were added. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Bulk Upload Materials"
      description="Upload a completed template to import multiple materials at once."
      loading={importing}
      loadingText="Importing materials..."
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
              : `Import ${rows.length > 0 ? rows.length : ""} Material${rows.length === 1 ? "" : "s"}`}
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
            onClick={() => document.getElementById("material-bulk-upload-input")?.click()}
          >
            <UploadCloud className="mr-2 h-4 w-4" />
            Choose File
          </Button>

          <input
            id="material-bulk-upload-input"
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
            {rows.length} material{rows.length === 1 ? "" : "s"} passed validation and{" "}
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
