"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import FormField from "@/components/ui/FormField";
import FormSection from "@/components/ui/FormSection";

import CustomerLookup from "@/components/lookup/CustomerLookup";
import type { CustomerRecord } from "@/components/services/customer.service";

import type { LR } from "../lr.schema";
import type { FieldErrors } from "@/lib/validation";

type PartyRole = "consignor" | "consignee";

interface PartySectionProps {
  role: PartyRole;
  lr: LR;
  errors?: FieldErrors<LR>;
  onChange: (lr: LR) => void;
}

const ROLE_CONFIG: Record<
  PartyRole,
  {
    title: string;
    subtitle: string;
    nameField: "consignor" | "consignee";
    gstField: "consignorGST" | "consigneeGST";
    addressField: "consignorAddress" | "consigneeAddress";
  }
> = {
  consignor: {
    title: "Consignor Details",
    subtitle: "Customer dispatching the goods",
    nameField: "consignor",
    gstField: "consignorGST",
    addressField: "consignorAddress",
  },
  consignee: {
    title: "Consignee Details",
    subtitle: "Customer receiving the goods",
    nameField: "consignee",
    gstField: "consigneeGST",
    addressField: "consigneeAddress",
  },
};

/**
 * Shared by the Consignor and Consignee sections of the LR form — the two
 * previously duplicated `ConsignorSection`/`ConsigneeSection` components
 * differed only in which three `LR` fields they read/wrote.
 */
export default function PartySection({
  role,
  lr,
  errors = {},
  onChange,
}: PartySectionProps) {
  const [lookupOpen, setLookupOpen] = useState(false);
  const config = ROLE_CONFIG[role];

  function update<K extends keyof LR>(key: K, value: LR[K]) {
    onChange({ ...lr, [key]: value });
  }

  function handleCustomerSelect(customer: CustomerRecord) {
    onChange({
      ...lr,
      [config.nameField]: customer.name,
      [config.gstField]: customer.gst,
      [config.addressField]: customer.address,
    });
  }

  return (
    <>
      <FormSection
        title={config.title}
        subtitle={config.subtitle}
      >
        <div className="space-y-5">
          <FormField
            label={role === "consignor" ? "Consignor" : "Consignee"}
            htmlFor={`lr-${role}-name`}
            required
            error={errors[config.nameField]}
          >
            <div className="flex gap-3">
              <Input
                id={`lr-${role}-name`}
                placeholder={`Select or enter ${role}`}
                value={lr[config.nameField]}
                onChange={(e) => update(config.nameField, e.target.value)}
              />

              <Button
                type="button"
                variant="outline"
                onClick={() => setLookupOpen(true)}
              >
                Search
              </Button>
            </div>
          </FormField>

          <FormField
            label="GST Number"
            htmlFor={`lr-${role}-gst`}
            error={errors[config.gstField]}
          >
            <Input
              id={`lr-${role}-gst`}
              placeholder="GST Number"
              value={lr[config.gstField]}
              onChange={(e) => update(config.gstField, e.target.value)}
            />
          </FormField>

          <FormField
            label="Address"
            htmlFor={`lr-${role}-address`}
          >
            <Input
              id={`lr-${role}-address`}
              placeholder={`${role === "consignor" ? "Consignor" : "Consignee"} Address`}
              value={lr[config.addressField]}
              onChange={(e) => update(config.addressField, e.target.value)}
            />
          </FormField>
        </div>
      </FormSection>

      <CustomerLookup
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelect={handleCustomerSelect}
      />
    </>
  );
}
