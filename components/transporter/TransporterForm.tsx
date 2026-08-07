"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";
import FormSection from "@/components/ui/FormSection";
import {
  PAYMENT_MODE_OPTIONS,
  PAYMENT_TERMS_OPTIONS,
  TRANSPORTER_STATUS_OPTIONS,
  TRANSPORTER_TYPE_OPTIONS,
  type Transporter,
} from "./transporter.schema";
import type { FieldErrors } from "@/lib/validation";

interface TransporterFormProps {
  transporter: Transporter;
  errors?: FieldErrors<Transporter>;
  onChange: (transporter: Transporter) => void;
  /** Whether this is a new (not-yet-created) transporter — controls the Transporter Code placeholder. */
  isNew?: boolean;
}

function toOptions(values: readonly string[]) {
  return values.map((value) => ({ label: value, value }));
}

export default function TransporterForm({
  transporter,
  errors = {},
  onChange,
  isNew = false,
}: TransporterFormProps) {
  function update<K extends keyof Transporter>(key: K, value: Transporter[K]) {
    onChange({ ...transporter, [key]: value });
  }

  function handlePaymentTermChange(value: string) {
    const paymentTerm = value as Transporter["paymentTerm"];
    onChange({
      ...transporter,
      paymentTerm,
      creditDays: paymentTerm === "Immediate" ? 0 : transporter.creditDays,
    });
  }

  return (
    <div className="space-y-6">
      <FormSection title="Identity">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label="Transporter Code"
            htmlFor="transporter-code"
            hint="Generated automatically and cannot be changed."
          >
            <Input
              id="transporter-code"
              value={transporter.code}
              placeholder={isNew ? "Auto Generated" : ""}
              disabled
              readOnly
            />
          </FormField>

          <FormField
            label="Transporter Name"
            htmlFor="transporter-name"
            required
            error={errors.transporterName}
          >
            <Input
              id="transporter-name"
              placeholder="Transporter Name"
              value={transporter.transporterName}
              onChange={(e) => update("transporterName", e.target.value)}
            />
          </FormField>

          <FormSelect
            label="Transporter Type"
            id="transporter-type"
            required
            error={errors.transporterType}
            value={transporter.transporterType}
            onValueChange={(value) => update("transporterType", value as Transporter["transporterType"])}
            options={toOptions(TRANSPORTER_TYPE_OPTIONS)}
          />

          <FormField
            label="GSTIN"
            htmlFor="transporter-gstin"
            error={errors.gstin}
          >
            <Input
              id="transporter-gstin"
              placeholder="GSTIN"
              value={transporter.gstin}
              onChange={(e) => update("gstin", e.target.value.toUpperCase())}
            />
          </FormField>

          <FormField
            label="PAN"
            htmlFor="transporter-pan"
            error={errors.pan}
          >
            <Input
              id="transporter-pan"
              placeholder="PAN"
              value={transporter.pan}
              onChange={(e) => update("pan", e.target.value.toUpperCase())}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Contact">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label="Contact Person"
            htmlFor="transporter-contact-person"
          >
            <Input
              id="transporter-contact-person"
              placeholder="Contact Person"
              value={transporter.contactPerson}
              onChange={(e) => update("contactPerson", e.target.value)}
            />
          </FormField>

          <FormField
            label="Mobile"
            htmlFor="transporter-mobile"
            error={errors.mobile}
          >
            <Input
              id="transporter-mobile"
              placeholder="Mobile Number"
              value={transporter.mobile}
              onChange={(e) => update("mobile", e.target.value)}
            />
          </FormField>

          <FormField
            label="Alternate Mobile"
            htmlFor="transporter-alternate-mobile"
            error={errors.alternateMobile}
          >
            <Input
              id="transporter-alternate-mobile"
              placeholder="Alternate Mobile Number"
              value={transporter.alternateMobile}
              onChange={(e) => update("alternateMobile", e.target.value)}
            />
          </FormField>

          <FormField
            label="Email"
            htmlFor="transporter-email"
            error={errors.email}
          >
            <Input
              id="transporter-email"
              type="email"
              placeholder="Email"
              value={transporter.email}
              onChange={(e) => update("email", e.target.value)}
            />
          </FormField>

          <FormField
            label="Website"
            htmlFor="transporter-website"
            error={errors.website}
          >
            <Input
              id="transporter-website"
              placeholder="Website"
              value={transporter.website}
              onChange={(e) => update("website", e.target.value)}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Address">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label="Address"
            htmlFor="transporter-address"
            className="sm:col-span-2"
          >
            <Textarea
              id="transporter-address"
              placeholder="Address"
              value={transporter.address}
              onChange={(e) => update("address", e.target.value)}
            />
          </FormField>

          <FormField
            label="City"
            htmlFor="transporter-city"
          >
            <Input
              id="transporter-city"
              placeholder="City"
              value={transporter.city}
              onChange={(e) => update("city", e.target.value)}
            />
          </FormField>

          <FormField
            label="State"
            htmlFor="transporter-state"
          >
            <Input
              id="transporter-state"
              placeholder="State"
              value={transporter.state}
              onChange={(e) => update("state", e.target.value)}
            />
          </FormField>

          <FormField
            label="Pincode"
            htmlFor="transporter-pincode"
            error={errors.pincode}
          >
            <Input
              id="transporter-pincode"
              placeholder="Pincode"
              value={transporter.pincode}
              onChange={(e) => update("pincode", e.target.value)}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Banking">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label="Account Holder Name"
            htmlFor="transporter-account-holder-name"
            error={errors.accountHolderName}
          >
            <Input
              id="transporter-account-holder-name"
              placeholder="Account Holder Name"
              value={transporter.accountHolderName}
              onChange={(e) => update("accountHolderName", e.target.value)}
            />
          </FormField>

          <FormField
            label="Bank Name"
            htmlFor="transporter-bank-name"
          >
            <Input
              id="transporter-bank-name"
              placeholder="Bank Name"
              value={transporter.bankName}
              onChange={(e) => update("bankName", e.target.value)}
            />
          </FormField>

          <FormField
            label="Account Number"
            htmlFor="transporter-account-number"
            error={errors.accountNumber}
          >
            <Input
              id="transporter-account-number"
              placeholder="Account Number"
              value={transporter.accountNumber}
              onChange={(e) => update("accountNumber", e.target.value)}
            />
          </FormField>

          <FormField
            label="IFSC"
            htmlFor="transporter-ifsc"
            error={errors.ifsc}
          >
            <Input
              id="transporter-ifsc"
              placeholder="IFSC Code"
              value={transporter.ifsc}
              onChange={(e) => update("ifsc", e.target.value.toUpperCase())}
            />
          </FormField>

          <FormField
            label="UPI ID"
            htmlFor="transporter-upi-id"
            error={errors.upiId}
          >
            <Input
              id="transporter-upi-id"
              placeholder="UPI ID"
              value={transporter.upiId}
              onChange={(e) => update("upiId", e.target.value)}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Commercial">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormSelect
            label="Payment Term"
            id="transporter-payment-term"
            error={errors.paymentTerm}
            value={transporter.paymentTerm}
            onValueChange={handlePaymentTermChange}
            options={toOptions(PAYMENT_TERMS_OPTIONS)}
          />

          <FormField
            label="Credit Days"
            htmlFor="transporter-credit-days"
            error={errors.creditDays}
            hint={transporter.paymentTerm === "Immediate" ? "Locked at 0 for Immediate payment terms." : undefined}
          >
            <Input
              id="transporter-credit-days"
              type="number"
              min={0}
              placeholder="0"
              value={transporter.creditDays}
              disabled={transporter.paymentTerm === "Immediate"}
              onChange={(e) => update("creditDays", Number(e.target.value))}
            />
          </FormField>

          <FormField
            label="Credit Limit"
            htmlFor="transporter-credit-limit"
            error={errors.creditLimit}
          >
            <Input
              id="transporter-credit-limit"
              type="number"
              min={0}
              placeholder="0"
              value={transporter.creditLimit}
              onChange={(e) => update("creditLimit", Number(e.target.value))}
            />
          </FormField>

          <FormSelect
            label="Preferred Payment Mode"
            id="transporter-payment-mode"
            error={errors.preferredPaymentMode}
            value={transporter.preferredPaymentMode}
            onValueChange={(value) => update("preferredPaymentMode", value as Transporter["preferredPaymentMode"])}
            options={toOptions(PAYMENT_MODE_OPTIONS)}
          />
        </div>
      </FormSection>

      <FormSection title="Additional">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormSelect
            label="Status"
            id="transporter-status"
            value={transporter.status}
            onValueChange={(value) => update("status", value as Transporter["status"])}
            options={toOptions(TRANSPORTER_STATUS_OPTIONS)}
          />

          <FormField
            label="Remarks"
            htmlFor="transporter-remarks"
            className="sm:col-span-2"
          >
            <Textarea
              id="transporter-remarks"
              placeholder="Remarks"
              value={transporter.remarks}
              onChange={(e) => update("remarks", e.target.value)}
            />
          </FormField>
        </div>
      </FormSection>
    </div>
  );
}
