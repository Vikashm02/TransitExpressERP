"use client";

import { useEffect, useState } from "react";

import FormDialog from "@/components/ui/FormDialog";
import FormField from "@/components/ui/FormField";
import FormDatePicker from "@/components/ui/FormDatePicker";
import FormSelect from "@/components/ui/FormSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import BlankableNumberInput from "@/components/common/BlankableNumberInput";
import BillingPartyLookup from "@/components/lookup/BillingPartyLookup";
import type { BillingPartyRecord } from "@/components/services/billingParty.service";
import type { CreditNoteRecord } from "@/components/services/creditNote.service";
import { GST_PERCENTAGE_OPTIONS, computeGstAmount, formatGstOption } from "@/lib/gstOptions";
import { validateCreditNote, type CreditNote } from "./creditNote.schema";

export type CreditNoteDialogMode = "create" | "edit" | "view";

interface CreditNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: CreditNoteDialogMode;
  /** Required for "edit"/"view"; ignored for "create". */
  creditNote?: CreditNoteRecord | null;
  loading?: boolean;
  onSubmit: (values: CreditNote) => void | Promise<void>;
}

interface FormState {
  billingPartyId: number;
  billingPartyName: string;
  noteDate: string;
  amount: number;
  deduction: number;
  gstPercentage: number;
  remarks: string;
}

const emptyState: FormState = {
  billingPartyId: 0,
  billingPartyName: "",
  noteDate: "",
  amount: 0,
  deduction: 0,
  gstPercentage: 0,
  remarks: "",
};

function money(value: number): string {
  return value.toFixed(2);
}

/**
 * Single dialog for Create / Edit / View — a "view" is simply an "edit"
 * with every field disabled and no Save action, so the exact same
 * computed Net Credit Received / GST preview is shown in both.
 *
 * Per the approved requirement: Amount, Discount/Deduction, and Net
 * Credit Received are always displayed and saved separately — the
 * deduction never disappears into a single collapsed total.
 */
export default function CreditNoteDialog({
  open,
  onOpenChange,
  mode,
  creditNote,
  loading = false,
  onSubmit,
}: CreditNoteDialogProps) {
  const [values, setValues] = useState<FormState>(emptyState);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const readOnly = mode === "view";

  useEffect(() => {
    if (!open) return;

    setFormError(null);

    setValues(
      creditNote
        ? {
            billingPartyId: creditNote.billingPartyId,
            billingPartyName: creditNote.billingPartyName,
            noteDate: creditNote.noteDate,
            amount: creditNote.amount,
            deduction: creditNote.deduction,
            gstPercentage: creditNote.gstPercentage,
            remarks: creditNote.remarks,
          }
        : emptyState
    );
  }, [open, creditNote]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleBillingPartySelect(record: BillingPartyRecord) {
    update("billingPartyId", record.id);
    update("billingPartyName", record.name);
  }

  // "Total Amount Received" IS the actual cash received — Discount/Deduction
  // is preserved as an informational/reconciliation figure only and is never
  // subtracted from it again (matches creditNote.service.ts).
  const netAmount = values.amount;
  const gstAmount = computeGstAmount(values.amount, values.gstPercentage);

  function handleSave() {
    const payload: CreditNote = {
      creditNoteNumber: creditNote?.creditNoteNumber ?? "",
      noteDate: values.noteDate,
      billingPartyId: values.billingPartyId,
      amount: values.amount,
      deduction: values.deduction,
      gstPercentage: values.gstPercentage,
      remarks: values.remarks,
    };

    const fieldErrors = validateCreditNote(payload);

    if (Object.keys(fieldErrors).length > 0) {
      setFormError(Object.values(fieldErrors)[0] ?? "Please fix the highlighted fields.");
      return;
    }

    setFormError(null);
    onSubmit(payload);
  }

  const title =
    mode === "create" ? "Create Credit Note" : mode === "edit" ? "Edit Credit Note" : "View Credit Note";

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        description="Amount, Discount/Deduction and Net Credit Received are always preserved separately — never collapsed into one value."
        loading={loading}
        loadingText="Saving Credit Note..."
        footer={
          readOnly ? (
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={loading}
              >
                {loading ? "Saving..." : "Save Credit Note"}
              </Button>
            </>
          )
        }
      >
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label="Credit Note Number"
            htmlFor="cn-number"
            hint={mode === "create" ? "Auto-generated from the Billing Party's Short Code on save." : "Frozen — assigned at creation."}
          >
            <Input
              id="cn-number"
              readOnly
              placeholder="Auto-generated on save"
              value={creditNote?.creditNoteNumber ?? ""}
            />
          </FormField>

          <FormField
            label="Billing Party"
            htmlFor="cn-billing-party"
            required
          >
            <div className="flex gap-3">
              <Input
                id="cn-billing-party"
                readOnly
                placeholder="Select billing party"
                value={values.billingPartyName}
              />

              {!readOnly && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLookupOpen(true)}
                >
                  Search
                </Button>
              )}
            </div>
          </FormField>

          <FormDatePicker
            label="Date"
            id="cn-date"
            required
            value={values.noteDate}
            onChange={(value) => update("noteDate", value)}
            disabled={readOnly}
          />

          <FormField
            label="Total Amount Received"
            htmlFor="cn-amount"
            required
          >
            <BlankableNumberInput
              id="cn-amount"
              min={0}
              readOnly={readOnly}
              blankWhenZero={mode === "create"}
              value={values.amount}
              onChange={(value) => update("amount", value)}
            />
          </FormField>

          <FormField
            label="Discount / Deduction"
            htmlFor="cn-deduction"
          >
            <BlankableNumberInput
              id="cn-deduction"
              min={0}
              readOnly={readOnly}
              blankWhenZero={mode === "create"}
              value={values.deduction}
              onChange={(value) => update("deduction", value)}
            />
          </FormField>

          <FormSelect
            label="GST"
            id="cn-gst"
            value={String(values.gstPercentage)}
            onValueChange={(value) => update("gstPercentage", Number(value))}
            disabled={readOnly}
            options={GST_PERCENTAGE_OPTIONS.map((option) => ({
              label: formatGstOption(option),
              value: String(option),
            }))}
          />

          <FormField
            label="Remarks"
            htmlFor="cn-remarks"
            className="sm:col-span-2"
          >
            <Textarea
              id="cn-remarks"
              placeholder="Optional remarks"
              readOnly={readOnly}
              value={values.remarks}
              onChange={(e) => update("remarks", e.target.value)}
            />
          </FormField>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 rounded-xl border bg-card p-6 shadow-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Total Amount Received</p>
            <p className="text-lg font-semibold">₹ {money(values.amount)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Discount / Deduction</p>
            <p className="text-lg font-semibold">₹ {money(values.deduction)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Net Credit Received</p>
            <p className="text-lg font-semibold text-success">₹ {money(netAmount)}</p>
          </div>

          {values.gstPercentage > 0 && (
            <div className="sm:col-span-3">
              <p className="text-xs text-muted-foreground">GST ({values.gstPercentage}%)</p>
              <p className="text-sm font-medium">₹ {money(gstAmount)}</p>
            </div>
          )}
        </div>

        {formError && (
          <p className="mt-4 text-sm font-medium text-destructive">{formError}</p>
        )}
      </FormDialog>

      <BillingPartyLookup
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelect={handleBillingPartySelect}
      />
    </>
  );
}
