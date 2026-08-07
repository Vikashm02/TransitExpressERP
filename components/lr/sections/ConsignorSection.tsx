"use client";

import { useState } from "react";

import { LR } from "../types";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import CustomerLookup from "@/components/lookup/CustomerLookup";
import { CustomerData } from "@/components/data";

interface ConsignorSectionProps {
  lr: LR;
  onChange: (lr: LR) => void;
}

export default function ConsignorSection({
  lr,
  onChange,
}: ConsignorSectionProps) {
  const [lookupOpen, setLookupOpen] = useState(false);

  function handleCustomerSelect(customer: CustomerData) {
    onChange({
      ...lr,
      consignor: customer.name,
      consignorGST: customer.gst,
      consignorAddress: customer.address,
    });
  }

  return (
    <>
      <div className="rounded-xl border bg-white shadow-sm p-6 space-y-6">

        <div className="border-b pb-3">

          <h2 className="text-xl font-semibold">
            Consignor Details
          </h2>

          <p className="text-sm text-slate-500 mt-1">
            Customer dispatching the goods
          </p>

        </div>

        <div className="space-y-5">

          <div>

            <label className="block text-sm font-medium mb-2">
              Consignor *
            </label>

            <div className="flex gap-3">

              <Input
                placeholder="Select or enter consignor"
                value={lr.consignor}
                onChange={(e) =>
                  onChange({
                    ...lr,
                    consignor: e.target.value,
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
              value={lr.consignorGST}
              onChange={(e) =>
                onChange({
                  ...lr,
                  consignorGST: e.target.value,
                })
              }
            />

          </div>

          <div>

            <label className="block text-sm font-medium mb-2">
              Address
            </label>

            <Input
              placeholder="Consignor Address"
              value={lr.consignorAddress}
              onChange={(e) =>
                onChange({
                  ...lr,
                  consignorAddress: e.target.value,
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