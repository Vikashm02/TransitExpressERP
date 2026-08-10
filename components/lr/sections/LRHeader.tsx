"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";
import FormDatePicker from "@/components/ui/FormDatePicker";
import FormSection from "@/components/ui/FormSection";

import BillingPartyLookup from "@/components/lookup/BillingPartyLookup";
import type { BillingPartyRecord } from "@/components/services/billingParty.service";

import { BILLING_PARTY_OPTIONS, BOOKING_BRANCH_OPTIONS, type LR } from "../lr.schema";
import type { FieldErrors } from "@/lib/validation";

interface LRHeaderProps {
  lr: LR;
  errors?: FieldErrors<LR>;
  onChange: (lr: LR) => void;
}

function toOptions(values: readonly string[]) {
  return values.map((value) => ({ label: value, value }));
}

export default function LRHeader({
  lr,
  errors = {},
  onChange,
}: LRHeaderProps) {
  const [lookupOpen, setLookupOpen] = useState(false);

  function update<K extends keyof LR>(key: K, value: LR[K]) {
    onChange({ ...lr, [key]: value });
  }

  function handleBillingPartySelect(billingParty: BillingPartyRecord) {
    update("customer", billingParty.name);
  }

  return (
    <>
      <FormSection
        title="LR Information"
        subtitle="Basic booking information"
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          <FormField
            label="LR Number"
            htmlFor="lr-number"
            hint="Auto-generated from Company Master Document Settings on save."
          >
            <Input
              id="lr-number"
              readOnly
              placeholder="Auto-generated on save"
              value={lr.lrNumber}
            />
          </FormField>

          <FormDatePicker
            label="LR Date"
            id="lr-date"
            required
            error={errors.lrDate}
            value={lr.lrDate}
            onChange={(value) => update("lrDate", value)}
          />

          <FormSelect
            label="Booking Branch"
            id="lr-booking-branch"
            required
            error={errors.bookingBranch}
            value={lr.bookingBranch}
            onValueChange={(value) => update("bookingBranch", value)}
            options={toOptions(BOOKING_BRANCH_OPTIONS)}
            placeholder="Select Branch"
          />

          {/* Billing Party — a distinct financial entity from the Billing
              Party Master, independent of Consignor/Consignee. Selection
              only; never free-typed into the master (see BillingPartyLookup). */}
          <FormField
            label="Billing Party"
            htmlFor="lr-billing-party-name"
            required
            error={errors.customer}
          >
            <div className="flex gap-3">
              <Input
                id="lr-billing-party-name"
                readOnly
                placeholder="Select billing party"
                value={lr.customer}
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

          {/* Pre-existing "GST Payable By" toggle (Consignor/Consignee) —
              printed on the LR as "GST Payable By". Unrelated to the
              Billing Party Master above; not renamed to avoid colliding
              with it. */}
          <FormSelect
            label="GST Payable By"
            id="lr-gst-payable-by"
            required
            error={errors.billingParty}
            value={lr.billingParty}
            onValueChange={(value) => update("billingParty", value as LR["billingParty"])}
            options={toOptions(BILLING_PARTY_OPTIONS)}
          />
        </div>
      </FormSection>

      <BillingPartyLookup
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelect={handleBillingPartySelect}
      />
    </>
  );
}
