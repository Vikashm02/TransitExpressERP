"use client";

import { Input } from "@/components/ui/input";
import { LR } from "../types";

interface DispatchDocumentsSectionProps {
  lr: LR;
  onChange: (lr: LR) => void;
}

export default function DispatchDocumentsSection({
  lr,
  onChange,
}: DispatchDocumentsSectionProps) {
  return (
    <div className="rounded-xl border bg-white shadow-sm p-6 space-y-6">

      <div className="border-b pb-3">

        <h2 className="text-xl font-semibold">
          Dispatch Documents
        </h2>

        <p className="text-sm text-slate-500 mt-1">
          Customer reference documents
        </p>

      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">

        {/* PO Number */}

        <div>

          <label className="block text-sm font-medium mb-2">
            PO Number
          </label>

          <Input
            placeholder="PO Number"
            value={lr.poNumber}
            onChange={(e) =>
              onChange({
                ...lr,
                poNumber: e.target.value,
              })
            }
          />

        </div>

        {/* Vendor Code */}

        <div>

          <label className="block text-sm font-medium mb-2">
            Vendor Code
          </label>

          <Input
            placeholder="Vendor Code"
            value={lr.vendorCode}
            onChange={(e) =>
              onChange({
                ...lr,
                vendorCode: e.target.value,
              })
            }
          />

        </div>

        {/* DC / Invoice Number */}

        <div>

          <label className="block text-sm font-medium mb-2">
            DC Number / Invoice Number
          </label>

          <Input
            placeholder="DC Number or Invoice Number"
            value={lr.dcNumber}
            onChange={(e) =>
              onChange({
                ...lr,
                dcNumber: e.target.value,
                invoiceNumber: e.target.value,
              })
            }
          />

        </div>

        {/* DC / Invoice Date */}

        <div>

          <label className="block text-sm font-medium mb-2">
            DC Date / Invoice Date
          </label>

          <Input
            type="date"
            value={lr.dcDate}
            onChange={(e) =>
              onChange({
                ...lr,
                dcDate: e.target.value,
                invoiceDate: e.target.value,
              })
            }
          />

        </div>

        {/* E-Way Bill */}

        <div>

          <label className="block text-sm font-medium mb-2">
            E-Way Bill Number
          </label>

          <Input
            placeholder="E-Way Bill Number"
            value={lr.ewayBillNumber}
            onChange={(e) =>
              onChange({
                ...lr,
                ewayBillNumber: e.target.value,
              })
            }
          />

        </div>

      </div>

    </div>
  );
}