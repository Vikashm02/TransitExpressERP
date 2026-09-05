"use client";

import { useState } from "react";
import { toast } from "sonner";
import { UploadCloud } from "lucide-react";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";

import { parseAndValidatePodUpload, type PodUploadRow, type PodUploadRowError } from "./podBulkUpload";
import { createPod } from "@/components/services/pod.service";
import { rollbackUploadBatch } from "@/components/services/uploadRollback.service";
import { updateLR, type LRRecord } from "@/components/services/lr.service";
import { getCompany } from "@/components/services/company.service";

interface PodBulkUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reuses the list already loaded by PodListPage — no extra fetch. */
  existingLRs: LRRecord[];
  onImported: () => void | Promise<void>;
}

export default function PodBulkUploadDialog({
  open,
  onOpenChange,
  existingLRs,
  onImported,
}: PodBulkUploadDialogProps) {
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [hasParsed, setHasParsed] = useState(false);
  const [rows, setRows] = useState<PodUploadRow[]>([]);
  const [errors, setErrors] = useState<PodUploadRowError[]>([]);
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
      const company = await getCompany();
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

      const result = await parseAndValidatePodUpload(file, existingLRs, {
        prefix: company.lrPrefix || "LR",
        prefixLength: company.lrPrefixLength || 4,
      });
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
    // Only LRs whose status this upload actually changed — keyed by LR id,
    // storing the exact status present before we marked them Delivered.
    const priorStatuses = new Map<number, LRRecord["status"]>();

    try {
      setImporting(true);

      for (const row of rows) {
        const created = await createPod(row.values);
        createdIds.push(created.id);

        // Mirrors PodListPage's `markLRDelivered` — after a POD is saved,
        // the linked LR is marked Delivered, its only field touched. Capture
        // the prior status first so a later failure can restore it exactly.
        const lr = existingLRs.find((record) => record.lrNumber === row.values.lrNumber);
        if (lr && lr.status !== "Delivered" && !priorStatuses.has(lr.id)) {
          priorStatuses.set(lr.id, lr.status);
          await updateLR(lr.id, { ...lr, status: "Delivered" });
        }
      }

      toast.success(`${rows.length} POD${rows.length === 1 ? "" : "s"} imported successfully.`);
      resetState();
      onOpenChange(false);
      await onImported();
    } catch (error) {
      console.error(error);

      // All-or-nothing: delete only PODs created by this upload, then restore
      // each LR this upload changed to its exact prior status.
      await rollbackUploadBatch("pods", createdIds).catch((rollbackError) =>
        console.error(rollbackError)
      );

      await Promise.all(
        Array.from(priorStatuses.entries()).map(async ([lrId, priorStatus]) => {
          const lr = existingLRs.find((record) => record.id === lrId);
          if (!lr) return;
          try {
            await updateLR(lr.id, { ...lr, status: priorStatus });
          } catch (rollbackError) {
            console.error(rollbackError);
          }
        })
      );

      toast.error("Import failed partway through and was rolled back. No PODs were added. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Bulk Upload PODs"
      description="Upload a completed template to import multiple PODs. Enter numeric LR numbers only (e.g. 19305)."
      loading={importing}
      loadingText="Importing PODs..."
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
              : `Import ${rows.length > 0 ? rows.length : ""} POD${rows.length === 1 ? "" : "s"}`}
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
            onClick={() => document.getElementById("pod-bulk-upload-input")?.click()}
          >
            <UploadCloud className="mr-2 h-4 w-4" />
            Choose File
          </Button>

          <input
            id="pod-bulk-upload-input"
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
            {rows.length} POD{rows.length === 1 ? "" : "s"} passed validation and{" "}
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
