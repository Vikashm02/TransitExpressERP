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
import type { DebitNoteRecord } from "@/components/services/debitNote.service";
import { GST_PERCENTAGE_OPTIONS, computeGstAmount, formatGstOption } from "@/lib/gstOptions";
import { validateDebitNote, type DebitNote } from "./debitNote.schema";

export type DebitNoteDialogMode = "create" | "edit" | "view";

interface DebitNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: DebitNoteDialogMode;
  /** Required for "edit"/"view"; ignored for "create". */
  debitNote?: DebitNoteRecord | null;
  loading?: boolean;
  onSubmit: (values: DebitNote) => void | Promise<void>;
}

interface FormState {
  billingPartyId: number;
  billingPartyName: string;
  noteDate: string;
  amount: number;
  gstPercentage: number;
  remarks: string;
}

const emptyState: FormState = {
  billingPartyId: 0,
  billingPartyName: "",
  noteDate: "",
  amount: 0,
  gstPercentage: 0,
  remarks: "",
};

function money(value: number): string {
  return value.toFixed(2);
}

/**
 * Single dialog for Create / Edit / View, mirroring
 * `components/creditNote/CreditNoteDialog.tsx` exactly — a "view" is an
 * "edit" with every field disabled and no Save action.
 */
export default function DebitNoteDialog({
  open,
  onOpenChange,
  mode,
  debitNote,
  loading = false,
  onSubmit,
}: DebitNoteDialogProps) {
  const [values, setValues] = useState<FormState>(emptyState);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const readOnly = mode === "view";

  useEffect(() => {
    if (!open) return;

    setFormError(null);

    setValues(
      debitNote
        ? {
            billingPartyId: debitNote.billingPartyId,
            billingPartyName: debitNote.billingPartyName,
            noteDate: debitNote.noteDate,
            amount: debitNote.amount,
            gstPercentage: debitNote.gstPercentage,
            remarks: debitNote.remarks,
          }
        : emptyState
    );
  }, [open, debitNote]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleBillingPartySelect(record: BillingPartyRecord) {
    update("billingPartyId", record.id);
    update("billingPartyName", record.name);
  }

  const gstAmount = computeGstAmount(values.amount, values.gstPercentage);
  const totalAmount = values.amount + gstAmount;

  function handleSave() {
    const payload: DebitNote = {
      debitNoteNumber: debitNote?.debitNoteNumber ?? "",
      noteDate: values.noteDate,
      billingPartyId: values.billingPartyId,
      amount: values.amount,
      gstPercentage: values.gstPercentage,
      remarks: values.remarks,
    };

    const fieldErrors = validateDebitNote(payload);

    if (Object.keys(fieldErrors).length > 0) {
      setFormError(Object.values(fieldErrors)[0] ?? "Please fix the highlighted fields.");
      return;
    }

    setFormError(null);
    onSubmit(payload);
  }

  const title =
    mode === "create" ? "Create Debit Note" : mode === "edit" ? "Edit Debit Note" : "View Debit Note";

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        description="A simple amount debited against a Billing Party, with optional GST."
        loading={loading}
        loadingText="Saving Debit Note..."
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
                {loading ? "Saving..." : "Save Debit Note"}
              </Button>
            </>
          )
        }
      >
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label="Debit Note Number"
            htmlFor="dn-number"
            hint={mode === "create" ? "Auto-generated from the Billing Party's Short Code on save." : "Frozen — assigned at creation."}
          >
            <Input
              id="dn-number"
              readOnly
              placeholder="Auto-generated on save"
              value={debitNote?.debitNoteNumber ?? ""}
            />
          </FormField>

          <FormField
            label="Billing Party"
            htmlFor="dn-billing-party"
            required
          >
            <div className="flex gap-3">
              <Input
                id="dn-billing-party"
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
            id="dn-date"
            required
            value={values.noteDate}
            onChange={(value) => update("noteDate", value)}
            disabled={readOnly}
          />

          <FormField
            label="Amount"
            htmlFor="dn-amount"
            required
          >
            <BlankableNumberInput
              id="dn-amount"
              min={0}
              readOnly={readOnly}
              blankWhenZero={mode === "create"}
              value={values.amount}
              onChange={(value) => update("amount", value)}
            />
          </FormField>

          <FormSelect
            label="GST"
            id="dn-gst"
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
            htmlFor="dn-remarks"
            className="sm:col-span-2"
          >
            <Textarea
              id="dn-remarks"
              placeholder="Optional remarks"
              readOnly={readOnly}
              value={values.remarks}
              onChange={(e) => update("remarks", e.target.value)}
            />
          </FormField>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 rounded-xl border bg-card p-6 shadow-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Amount</p>
            <p className="text-lg font-semibold">₹ {money(values.amount)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">GST ({values.gstPercentage}%)</p>
            <p className="text-lg font-semibold">₹ {money(gstAmount)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-semibold">₹ {money(totalAmount)}</p>
          </div>
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
