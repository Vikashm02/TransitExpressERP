"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FormDialog from "@/components/ui/FormDialog";
import FormField from "@/components/ui/FormField";
import FormDatePicker from "@/components/ui/FormDatePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import { amountInWords } from "@/lib/numberToWords";
import {
  getBill,
  updateBill,
  type BillDetail,
  type BillLineRecord,
  type BillRecord,
} from "@/components/services/billing.service";

interface EditBillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bill: BillRecord | null;
  onSaved: () => void | Promise<void>;
}

function money(value: number): string {
  return value.toFixed(2);
}

/**
 * A generated Bill is a frozen financial document. Only `billDate` /
 * `poNumber` are editable here — Bill Number, Billing Party, and every
 * `bill_lrs` line (weight/rate/freight) are loaded and displayed
 * read-only for context, and are never recalculated or sent to
 * `updateBill()`. No LR can be added or removed from an existing Bill.
 */
export default function EditBillDialog({ open, onOpenChange, bill, onSaved }: EditBillDialogProps) {
  const [detail, setDetail] = useState<BillDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [billDate, setBillDate] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !bill) return;

    setBillDate(bill.billDate);
    setPoNumber(bill.poNumber);
    setDetail(null);

    let cancelled = false;
    setLoadingDetail(true);

    getBill(bill.id)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, bill]);

  async function handleSave() {
    if (!bill || !billDate.trim()) {
      toast.error("Bill date is required.");
      return;
    }

    try {
      setSaving(true);
      await updateBill(bill.id, { billDate, poNumber });
      toast.success(`Bill ${bill.billNumber} updated successfully.`);
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      console.error(error);
      toast.error("Unable to update bill.");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    onOpenChange(false);
  }

  const columns: DataTableColumn<BillLineRecord>[] = [
    { key: "lrNumber", header: "LR No.", render: (row) => row.lr?.lrNumber ?? "" },
    { key: "consignee", header: "Consignee", render: (row) => row.lr?.consignee ?? "" },
    { key: "weight", header: "Weight", align: "right", render: (row) => row.weight.toFixed(2) },
    { key: "rate", header: "Rate", align: "right", render: (row) => money(row.rate) },
    { key: "freight", header: "Freight", align: "right", render: (row) => money(row.freight) },
  ];

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit Bill"
      description="A generated Bill is a frozen financial document — only the Bill Date and PO Number can be changed."
      size="lg"
      loading={saving}
      loadingText="Saving Bill..."
      footer={
        <>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={saving}
          >
            Cancel
          </Button>

          <Button
            onClick={handleSave}
            disabled={saving || !bill}
          >
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </>
      }
    >
      {bill && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-5 rounded-xl border bg-card p-6 shadow-sm md:grid-cols-2 xl:grid-cols-4">
            <FormField
              label="Bill Number"
              htmlFor="edit-bill-number"
              hint="Frozen — never changes after generation."
            >
              <Input
                id="edit-bill-number"
                readOnly
                value={bill.billNumber}
              />
            </FormField>

            <FormField
              label="Billing Party"
              htmlFor="edit-bill-party"
              hint="Frozen — cannot be reassigned after generation."
            >
              <Input
                id="edit-bill-party"
                readOnly
                value={bill.billingPartyName}
              />
            </FormField>

            <FormField
              label="PO Number"
              htmlFor="edit-bill-po-number"
            >
              <Input
                id="edit-bill-po-number"
                placeholder="PO Number"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
              />
            </FormField>

            <FormDatePicker
              label="Bill Date"
              id="edit-bill-date"
              required
              value={billDate}
              onChange={setBillDate}
            />
          </div>

          <div className="space-y-3">
            <h3 className="text-base font-medium">Billed LRs (frozen)</h3>

            <DataTable
              columns={columns}
              data={detail?.lines ?? []}
              rowKey={(row) => row.id}
              loading={loadingDetail}
              emptyTitle="No LR lines"
              maxHeight="280px"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 rounded-xl border bg-card p-6 shadow-sm sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Number of LRs</p>
              <p className="text-lg font-semibold">{bill.lrCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Weight</p>
              <p className="text-lg font-semibold">{bill.totalWeight.toFixed(2)} MT</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Freight</p>
              <p className="text-lg font-semibold">₹ {money(bill.totalFreight)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Grand Total</p>
              <p className="text-lg font-semibold">₹ {money(bill.grandTotal)}</p>
            </div>

            <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-4">
              {amountInWords(bill.grandTotal)}
            </p>
          </div>
        </div>
      )}
    </FormDialog>
  );
}
