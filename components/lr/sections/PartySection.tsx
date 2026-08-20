"use client";

import { useEffect, useMemo, useState } from "react";

import FormField from "@/components/ui/FormField";
import FormSection from "@/components/ui/FormSection";
import { Input } from "@/components/ui/input";
import MasterAutocomplete, {
  type MasterAutocompleteOption,
} from "@/components/lookup/MasterAutocomplete";
import {
  getCustomers,
  type CustomerRecord,
} from "@/components/services/customer.service";

import type { LR } from "../lr.schema";
import type { FieldErrors } from "@/lib/validation";
import { lrFieldHelp } from "@/lib/help";

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
    subtitle: "Select from Customer Master only",
    nameField: "consignor",
    gstField: "consignorGST",
    addressField: "consignorAddress",
  },
  consignee: {
    title: "Consignee Details",
    subtitle: "Select from Customer Master only",
    nameField: "consignee",
    gstField: "consigneeGST",
    addressField: "consigneeAddress",
  },
};

/**
 * Consignor / Consignee must be selected from Customer Master.
 * Free-text names are not accepted.
 */
export default function PartySection({
  role,
  lr,
  errors = {},
  onChange,
}: PartySectionProps) {
  const config = ROLE_CONFIG[role];
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCustomers()
      .then((data) => {
        if (!cancelled) {
          setCustomers(data.filter((c) => (c as CustomerRecord & { entryStatus?: string }).entryStatus !== "draft"));
        }
      })
      .catch((error) => console.error(error))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const options: MasterAutocompleteOption[] = useMemo(
    () =>
      customers.map((customer) => ({
        id: customer.id,
        label: customer.name,
        description: [customer.code, customer.city, customer.gst].filter(Boolean).join(" · "),
        keywords: `${customer.code} ${customer.gst} ${customer.city} ${customer.address}`,
      })),
    [customers]
  );

  function handleSelect(option: MasterAutocompleteOption) {
    const customer = customers.find((c) => c.id === option.id);
    if (!customer) return;
    onChange({
      ...lr,
      [config.nameField]: customer.name,
      [config.gstField]: customer.gst,
      [config.addressField]: customer.address,
    });
  }

  function handleClear() {
    onChange({
      ...lr,
      [config.nameField]: "",
      [config.gstField]: "",
      [config.addressField]: "",
    });
  }

  return (
    <FormSection title={config.title} subtitle={config.subtitle}>
      <div className="space-y-5">
        <FormField
          label={role === "consignor" ? "Consignor" : "Consignee"}
          htmlFor={`lr-${role}-name`}
          required
          error={errors[config.nameField]}
          helpText={
            role === "consignor"
              ? lrFieldHelp.consignor
              : lrFieldHelp.consignee
          }
          hint="Type to search Customer Master, then select a row. Free text is not allowed."
        >
          <MasterAutocomplete
            id={`lr-${role}-name`}
            value={lr[config.nameField]}
            options={options}
            loading={loading}
            onSelect={handleSelect}
            onClear={handleClear}
            placeholder={`Type to find ${role}...`}
            emptyMessage="No matching customer in master data."
          />
        </FormField>

        <FormField label="GST Number" htmlFor={`lr-${role}-gst`} error={errors[config.gstField]}>
          <Input
            id={`lr-${role}-gst`}
            readOnly
            placeholder="Filled from master"
            value={lr[config.gstField]}
          />
        </FormField>

        <FormField
          label="Address"
          htmlFor={`lr-${role}-address`}
          error={errors[config.addressField]}
        >
          <Input
            id={`lr-${role}-address`}
            readOnly
            placeholder="Filled from master"
            value={lr[config.addressField]}
          />
        </FormField>
      </div>
    </FormSection>
  );
}
