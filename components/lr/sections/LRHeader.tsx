"use client";

import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";
import FormDatePicker from "@/components/ui/FormDatePicker";
import FormSection from "@/components/ui/FormSection";
import MasterAutocomplete, {
  type MasterAutocompleteOption,
} from "@/components/lookup/MasterAutocomplete";
import {
  getLrBillingPartyLookup,
  type LrBillingPartyLookupRow,
} from "@/components/services/billingParty.service";

import { BILLING_PARTY_OPTIONS, BOOKING_BRANCH_OPTIONS, type LR } from "../lr.schema";
import type { FieldErrors } from "@/lib/validation";
import { isDraftLrNumber } from "@/lib/entryStatus";
import { lrFieldHelp } from "@/lib/help";

interface LRHeaderProps {
  lr: LR;
  errors?: FieldErrors<LR>;
  onChange: (lr: LR) => void;
  /** Preview only — does not allocate. Shown when creating a new LR. */
  nextLrNumberPreview?: string;
}

function toOptions(values: readonly string[]) {
  return values.map((value) => ({ label: value, value }));
}

export default function LRHeader({
  lr,
  errors = {},
  onChange,
  nextLrNumberPreview = "",
}: LRHeaderProps) {
  const [parties, setParties] = useState<LrBillingPartyLookupRow[]>([]);
  const [loadingParties, setLoadingParties] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingParties(true);
    getLrBillingPartyLookup()
      .then((data) => {
        if (!cancelled) {
          // RPC already returns finalized rows only.
          setParties(data.filter((p) => p.entryStatus !== "draft"));
        }
      })
      .catch((error) => console.error(error))
      .finally(() => {
        if (!cancelled) setLoadingParties(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const options: MasterAutocompleteOption[] = useMemo(
    () =>
      parties.map((party) => ({
        id: party.id,
        label: party.name,
        description: [party.code, party.city, party.gst].filter(Boolean).join(" · "),
        keywords: `${party.code} ${party.gst} ${party.city}`,
      })),
    [parties]
  );

  function update<K extends keyof LR>(key: K, value: LR[K]) {
    onChange({ ...lr, [key]: value });
  }

  const displayNumber = lr.lrNumber?.trim()
    ? lr.lrNumber
    : nextLrNumberPreview;

  const hasReservedNumber = Boolean(lr.lrNumber?.trim()) && !isDraftLrNumber(lr.lrNumber);

  return (
    <FormSection title="LR Information" subtitle="Basic booking information">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        <FormField
          label="LR Number"
          htmlFor="lr-number"
          helpText={lrFieldHelp.lrNumber}
          hint={
            hasReservedNumber
              ? lr.entryStatus === "draft"
                ? "Reserved for this draft. Completing the LR keeps this number."
                : undefined
              : "Preview only. Opening this form does not reserve a number — the next LR number is reserved when the draft is first autosaved."
          }
        >
          <Input
            id="lr-number"
            readOnly
            placeholder="Reserved on first draft save"
            value={displayNumber}
          />
        </FormField>

        <FormDatePicker
          label="LR Date"
          id="lr-date"
          required
          error={errors.lrDate}
          helpText={lrFieldHelp.lrDate}
          value={lr.lrDate}
          onChange={(value) => update("lrDate", value)}
        />

        <FormSelect
          label="Booking Branch"
          id="lr-booking-branch"
          required
          error={errors.bookingBranch}
          helpText={lrFieldHelp.bookingBranch}
          value={lr.bookingBranch}
          onValueChange={(value) => update("bookingBranch", value)}
          options={toOptions(BOOKING_BRANCH_OPTIONS)}
          placeholder="Select Branch"
        />

        <FormField
          label="Billing Party"
          htmlFor="lr-billing-party-name"
          required
          error={errors.customer}
          helpText={lrFieldHelp.billingParty}
          hint="Type to search Billing Party Master, then select. Free text is not allowed."
        >
          <MasterAutocomplete
            id="lr-billing-party-name"
            value={lr.customer}
            options={options}
            loading={loadingParties}
            onSelect={(option) => update("customer", option.label)}
            onClear={() => update("customer", "")}
            placeholder="Type to find billing party..."
            emptyMessage="No matching billing party in master data."
          />
        </FormField>

        <FormSelect
          label="GST Payable By"
          id="lr-gst-payable-by"
          required
          error={errors.billingParty}
          helpText={lrFieldHelp.gstPayableBy}
          value={lr.billingParty}
          onValueChange={(value) => update("billingParty", value as LR["billingParty"])}
          options={toOptions(BILLING_PARTY_OPTIONS)}
        />
      </div>
    </FormSection>
  );
}
