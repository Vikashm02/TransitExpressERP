"use client";

import { useState } from "react";

import { LR } from "../types";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import CustomerLookup from "@/components/lookup/CustomerLookup";
import { CustomerData } from "@/components/data";

interface ConsigneeSectionProps {
  lr: LR;
  onChange: (lr: LR) => void;
}

export default function ConsigneeSection({
  lr,
  onChange,
}: ConsigneeSectionProps) {
  const [lookupOpen, setLookupOpen] = useState(false);

  function handleCustomerSelect(customer: CustomerData) {
    onChange({
      ...lr,
      consignee: customer.name,
      consigneeGST: customer.gst,
      consigneeAddress: customer.address,
    });
  }

  return (
    <>
      <div className="rounded-xl border bg-white shadow-sm p-6 space-y-6">

        <div className="border-b pb-3">

          <h2 className="text-xl font-semibold">
            Consignee Details
          </h2>

          <p className="text-sm text-slate-500 mt-1">
            Customer receiving the goods
          </p>

        </div>

        <div className="space-y-5">

          <div>

            <label className="block text-sm font-medium mb-2">
              Consignee *
            </label>

            <div className="flex gap-3">

              <Input
                placeholder="Select or enter consignee"
                value={lr.consignee}
                onChange={(e) =>
                  onChange({
                    ...lr,
                    consignee: e.target.value,
                  })
                }
              />

              <Button
                type="button"
                variant="outline"
                onClick={() => setLookupOpen(true)}
              >
                Search
              </Button>

            </div>

          </div>

          <div>

            <label className="block text-sm font-medium mb-2">
              GST Number
            </label>

            <Input
              placeholder="GST Number"
              value={lr.consigneeGST}
              onChange={(e) =>
                onChange({
                  ...lr,
                  consigneeGST: e.target.value,
                })
              }
            />

          </div>

          <div>

            <label className="block text-sm font-medium mb-2">
              Address
            </label>

            <Input
              placeholder="Consignee Address"
              value={lr.consigneeAddress}
              onChange={(e) =>
                onChange({
                  ...lr,
                  consigneeAddress: e.target.value,
                })
              }
            />

          </div>

        </div>

      </div>

      <CustomerLookup
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelect={handleCustomerSelect}
      />
    </>
  );
}