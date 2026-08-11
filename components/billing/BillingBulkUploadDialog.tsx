"use client";

import { useState } from "react";
import { toast } from "sonner";
import { UploadCloud } from "lucide-react";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";

import {
  parseAndValidateBillingUpload,
  type BillingUploadGroup,
  type BillingUploadRowError,
} from "./billingBulkUpload";
import { createBill, deleteBill } from "@/components/services/billing.service";
import { getCompany, saveCompany } from "@/components/services/company.service";
import { getBillingParties } from "@/components/services/billingParty.service";
import { getLRs, updateLR, type LRRecord } from "@/components/services/lr.service";
import { getPods } from "@/components/services/pod.service";

interface BillingBulkUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void | Promise<void>;
}

export default function BillingBulkUploadDialog({
  open,
  onOpenChange,
  onImported,
}: BillingBulkUploadDialogProps) {
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [hasParsed, setHasParsed] = useState(false);
  const [groups, setGroups] = useState<BillingUploadGroup[]>([]);
  const [errors, setErrors] = useState<BillingUploadRowError[]>([]);
  const [importing, setImporting] = useState(false);

  function resetState() {
    setFileName("");
    setHasParsed(false);
    setGroups([]);
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
    setGroups([]);
    setErrors([]);

    try {
      setParsing(true);
      const [billingParties, lrs, pods] = await Promise.all([getBillingParties(), getLRs(), getPods()]);
      const result = await parseAndValidateBillingUpload(file, billingParties, lrs, pods);
      setGroups(result.groups);
      setErrors(result.errors);
      setHasParsed(true);
    } catch (error) {
      console.error(error);
      toast.error("Unable to read this file. Confirm it's a valid .xlsx file based on the downloaded template.");
    } finally {
      setParsing(false);
    }
  }

  /**
   * Marks the given LRs as Billed (same rule as BillingListPage), but
   * records each LR's exact prior status so a later failure can restore it.
   * Only LRs whose status is actually changed are added to `priorStatuses`.
   */
  async function markLRsBilled(
    lrIds: string[],
    priorStatuses: Map<number, LRRecord["status"]>
  ) {
    const lrs = await getLRs();
    const targets = lrs.filter((lr) => lrIds.includes(String(lr.id)) && lr.status !== "Billed");

    for (const lr of targets) {
      if (!priorStatuses.has(lr.id)) {
        priorStatuses.set(lr.id, lr.status);
      }
      await updateLR(lr.id, { ...lr, status: "Billed" });
    }
  }

  async function handleImport() {
    if (groups.length === 0) return;

    try {
      setImporting(true);

      // Same automatic Bill Number generation BillingListPage's
      // `handleSubmit` already uses for a single Bill: Invoice Prefix +
      // zero-padded next running number from Company Master Document
      // Settings. Reserved in-memory here (not persisted per-bill) so the
      // whole batch can be rolled back together if any bill fails to
      // insert — the running number itself is only persisted once, after
      // every bill has been created successfully.
      const company = await getCompany();

      if (!company) {
        toast.error("Configure Company Settings (Invoice Prefix) before creating a Bill.");
        return;
      }

      const createdIds: number[] = [];
      const priorStatuses = new Map<number, LRRecord["status"]>();
      let nextRunningNumber = company.invoiceRunningNumber ?? 0;

      try {
        for (const group of groups) {
          nextRunningNumber += 1;
          const billNumber = `${company.invoicePrefix}${String(nextRunningNumber).padStart(
            company.invoicePrefixLength || 4,
            "0"
          )}`;

          const created = await createBill({ ...group.values, billNumber }, group.lines);
          createdIds.push(created.id);
          await markLRsBilled(group.values.lrIds, priorStatuses);
        }

        await saveCompany({ ...company, invoiceRunningNumber: nextRunningNumber }, company.id);
      } catch (error) {
        // All-or-nothing: roll back every Bill created so far in this
        // batch (their `bill_lrs` lines cascade-delete automatically),
        // then restore each LR this upload marked Billed to its exact
        // prior status. The running number is never persisted unless
        // every bill succeeded, so it doesn't need to be rolled back.
        await Promise.all(
          createdIds.map((id) => deleteBill(id).catch((rollbackError) => console.error(rollbackError)))
        );

        if (priorStatuses.size > 0) {
          const lrs = await getLRs();
          await Promise.all(
            Array.from(priorStatuses.entries()).map(async ([lrId, priorStatus]) => {
              const lr = lrs.find((record) => record.id === lrId);
              if (!lr) return;
              try {
                await updateLR(lr.id, { ...lr, status: priorStatus });
              } catch (rollbackError) {
                console.error(rollbackError);
              }
            })
          );
        }

        throw error;
      }

      toast.success(`${groups.length} bill${groups.length === 1 ? "" : "s"} imported successfully.`);
      resetState();
      onOpenChange(false);
      await onImported();
    } catch (error) {
      console.error(error);
      toast.error("Import failed partway through and was rolled back. No bills were added. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  const lrCount = groups.reduce((sum, group) => sum + group.lines.length, 0);

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Bulk Upload Bills"
      description="Upload a completed template to import multiple bills at once."
      loading={importing}
      loadingText="Importing bills..."
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
            disabled={importing || parsing || groups.length === 0}
          >
            {importing
              ? "Importing..."
              : `Import ${groups.length > 0 ? groups.length : ""} Bill${groups.length === 1 ? "" : "s"}`}
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
            onClick={() => document.getElementById("billing-bulk-upload-input")?.click()}
          >
            <UploadCloud className="mr-2 h-4 w-4" />
            Choose File
          </Button>

          <input
            id="billing-bulk-upload-input"
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
          Multiple rows sharing the same &quot;Bill Group&quot; value are combined into one Bill with multiple LRs.
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

        {!parsing && hasParsed && errors.length === 0 && groups.length > 0 && (
          <p className="text-sm font-medium text-success">
            {groups.length} bill{groups.length === 1 ? "" : "s"} ({lrCount} LR{lrCount === 1 ? "" : "s"}) passed
            validation and {groups.length === 1 ? "is" : "are"} ready to import.
          </p>
        )}

        {!parsing && hasParsed && errors.length === 0 && groups.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No data rows were found in the &quot;Upload Data&quot; sheet.
          </p>
        )}
      </div>
    </FormDialog>
  );
}
