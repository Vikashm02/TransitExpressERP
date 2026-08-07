"use client";

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import LRForm from "./LRForm";
import { LR } from "./types";

import { saveLR } from "@/components/services/lr.service";

interface LRDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const emptyLR: LR = {
  // ===========================
  // LR Information
  // ===========================

  lrNumber: "",
  lrDate: "",
  bookingBranch: "",

  customer: "",

  billingParty: "Consignor",

  // ===========================
  // Consignor

  consignor: "",
  consignorGST: "",
  consignorAddress: "",

  // ===========================
  // Consignee

  consignee: "",
  consigneeGST: "",
  consigneeAddress: "",

  // ===========================
  // Vehicle

  vehicleNumber: "",
  vehicleType: "",

  transporter: "",

  driverName: "",
  driverMobile: "",

  from: "",
  to: "",

  // ===========================
  // Material

  material: "",

  packageType: "",

  packages: 0,

  loadingWeight: 0,

  chargedWeight: 0,

  // ===========================
  // Dispatch

  poNumber: "",

  vendorCode: "",

  dcNumber: "",

  dcDate: "",

  invoiceNumber: "",

  invoiceDate: "",

  ewayBillNumber: "",

  // ===========================
  // Commercial

  billRate: 0,

  billRateType: "Fixed",

  guaranteedWeight: 0,

  vehicleGuaranteedWeight: 0,

  lorryHireRate: 0,

  lorryHireType: "Fixed",

  freightType: "To Be Billed",

  driverAdvance: 0,

  dieselAdvance: 0,

  stChallan: 0,

  loadingCharges: 0,

  unloadingCharges: 0,

  hamali: 0,

  commission: 0,

  otherExpense: 0,

  // ===========================
  // Calculated

  billAmount: 0,

  lorryHireAmount: 0,

  profitAmount: 0,

  // ===========================
  // Remarks

  remarks: "",

  internalRemarks: "",

  // ===========================
  // Status

  status: "Open",

  createdAt: "",

  updatedAt: "",
};

export default function LRDialog({
  open,
  onOpenChange,
}: LRDialogProps) {
  const [lr, setLR] = useState<LR>(emptyLR);

  const [saving, setSaving] = useState(false);

  async function handleSave() {
    try {
      setSaving(true);

      await saveLR(lr);

      alert("LR saved successfully.");

      setLR(emptyLR);

      onOpenChange(false);
    } catch (err) {
      console.error(err);

      alert("Unable to save LR.");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setLR(emptyLR);

    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent
        className="
          w-[98vw]
          max-w-none
          h-[96vh]
          max-h-none
          rounded-2xl
          overflow-hidden
          p-0
        "
      >
        <DialogHeader className="border-b bg-white px-8 py-6">

          <DialogTitle className="text-3xl font-bold">
            Create Lorry Receipt
          </DialogTitle>

          <p className="text-sm text-slate-500">
            Enter shipment, vehicle and commercial details.
          </p>

        </DialogHeader>

        <div className="h-[calc(96vh-95px)] overflow-y-auto bg-slate-50 px-8 py-8">

          <LRForm
            lr={lr}
            onChange={setLR}
            onSave={handleSave}
            onCancel={handleCancel}
          />

        </div>

        {saving && (
          <div className="absolute inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center">

            <div className="rounded-xl bg-white border shadow-lg px-8 py-5">

              <p className="font-semibold">
                Saving Lorry Receipt...
              </p>

            </div>

          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}