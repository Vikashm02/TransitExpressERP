"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";
import { BILLING_PARTY_STATUS_OPTIONS, type BillingPartyMaster } from "./billingParty.schema";
import type { FieldErrors } from "@/lib/validation";

interface BillingPartyFormProps {
  billingParty: BillingPartyMaster;
  errors?: FieldErrors<BillingPartyMaster>;
  onChange: (billingParty: BillingPartyMaster) => void;
}

export default function BillingPartyForm({
  billingParty,
  errors = {},
  onChange,
}: BillingPartyFormProps) {
  function update<K extends keyof BillingPartyMaster>(key: K, value: BillingPartyMaster[K]) {
    onChange({ ...billingParty, [key]: value });
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <FormField
        label="Billing Party Name"
        htmlFor="billing-party-name"
        required
        error={errors.name}
      >
        <Input
          id="billing-party-name"
          placeholder="Billing Party Name"
          value={billingParty.name}
          onChange={(e) => update("name", e.target.value)}
        />
      </FormField>

      <FormField
        label="GST Number"
        htmlFor="billing-party-gst"
        error={errors.gst}
      >
        <Input
          id="billing-party-gst"
          placeholder="GST Number"
          value={billingParty.gst}
          onChange={(e) => update("gst", e.target.value.toUpperCase())}
        />
      </FormField>

      <FormField
        label="Mobile Number"
        htmlFor="billing-party-mobile"
        error={errors.mobile}
      >
        <Input
          id="billing-party-mobile"
          placeholder="Mobile Number"
          value={billingParty.mobile}
          onChange={(e) => update("mobile", e.target.value)}
        />
      </FormField>

      <FormField
        label="Email"
        htmlFor="billing-party-email"
        error={errors.email}
      >
        <Input
          id="billing-party-email"
          type="email"
          placeholder="Email"
          value={billingParty.email}
          onChange={(e) => update("email", e.target.value)}
        />
      </FormField>

      <FormField
        label="City"
        htmlFor="billing-party-city"
        error={errors.city}
      >
        <Input
          id="billing-party-city"
          placeholder="City"
          value={billingParty.city}
          onChange={(e) => update("city", e.target.value)}
        />
      </FormField>

      <FormField
        label="PO Number"
        htmlFor="billing-party-po-number"
        error={errors.poNumber}
        hint="Auto-filled onto a new Bill when this billing party is selected."
      >
        <Input
          id="billing-party-po-number"
          placeholder="PO Number"
          value={billingParty.poNumber}
          onChange={(e) => update("poNumber", e.target.value)}
        />
      </FormField>

      <FormField
        label="Concern Person"
        htmlFor="billing-party-concern-person"
        error={errors.concernPerson}
      >
        <Input
          id="billing-party-concern-person"
          placeholder="Concern Person"
          value={billingParty.concernPerson}
          onChange={(e) => update("concernPerson", e.target.value)}
        />
      </FormField>

      <FormField
        label="Short Code"
        htmlFor="billing-party-short-code"
        error={errors.shortCode}
        hint="Used as the prefix for this party's Credit/Debit Note numbers, e.g. ACC, ZIGMA. Required before creating a Credit or Debit Note."
      >
        <Input
          id="billing-party-short-code"
          placeholder="e.g. ACC"
          value={billingParty.shortCode}
          onChange={(e) => update("shortCode", e.target.value.toUpperCase())}
        />
      </FormField>

      <FormField
        label="Payment Cycle (Days)"
        htmlFor="billing-party-payment-cycle"
        error={errors.paymentCycleDays}
        hint="Normal number of days this party takes to pay after a Bill is submitted, e.g. 15 or 30. Used by the Outstanding Payment report."
      >
        <Input
          id="billing-party-payment-cycle"
          type="number"
          min={0}
          value={billingParty.paymentCycleDays}
          onChange={(e) => update("paymentCycleDays", Number(e.target.value))}
        />
      </FormField>

      <FormSelect
        label="Status"
        id="billing-party-status"
        value={billingParty.status}
        onValueChange={(value) => update("status", value as BillingPartyMaster["status"])}
        options={BILLING_PARTY_STATUS_OPTIONS.map((status) => ({
          label: status,
          value: status,
        }))}
      />

      <FormField
        label="Address"
        htmlFor="billing-party-address"
        error={errors.address}
        className="sm:col-span-2"
      >
        <Textarea
          id="billing-party-address"
          placeholder="Address"
          value={billingParty.address}
          onChange={(e) => update("address", e.target.value)}
        />
      </FormField>
    </div>
  );
}
